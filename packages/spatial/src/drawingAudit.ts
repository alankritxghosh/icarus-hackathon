// Holds a spatial model against what a drawing actually shows. A model that was read from, or is meant to
// reproduce, a supplied drawing must not add walls the sheet does not draw, leave out walls it does, or
// rename and move the rooms it labels. The evidence is measured from the sheet (filled shapes and text), so
// this check does not rely on a model's reading of the picture.
//
// Limits, stated so nobody over-trusts a pass: only axis-aligned walls are compared, door and window
// positions and furniture orientation are not checked, and a drawing with no vector shapes (a photograph
// or scan) cannot be audited at all.

import type { SpatialModel, Wall } from "./schema";
import type { Finding } from "./validate";

/** An axis-aligned rectangle in millimetres: [x0, y0, x1, y1] with x0 < x1 and y0 < y1. */
export type Rect = readonly [number, number, number, number];

export interface DrawingLabel {
  text: string;
  /** Where the text sits, millimetres in the model's frame. */
  at: readonly [number, number];
  /** room: names a space; object: names a fitting; dimension: a printed size, not a name. */
  role: "room" | "object" | "dimension";
  /** For a room label: the size the sheet prints beneath the name, millimetres [across, deep]. */
  printedSizeMm?: readonly [number, number];
}

export interface DrawingEvidence {
  schema: "icarus.drawing-evidence/0.1";
  source: string;
  /** Filled shapes the sheet uses for walls. */
  wallRects: Rect[];
  /** Filled shapes that are structure only (columns, cores): they may support a wall but never demand one. */
  supportRects: Rect[];
  labels: DrawingLabel[];
}

export interface DrawingAudit {
  ok: boolean;
  findings: Finding[];
  checked: { modelWalls: number; drawnWalls: number; roomLabels: number };
  notAudited: string[];
}

/** Which items a space of a given kind must hold, so a labelled gym is not an empty box. Extend per product. */
export const EXPECTED_CONTENTS: readonly { kind: RegExp; anyOf: readonly string[] }[] = [
  { kind: /(^|\.)bedroom$/, anyOf: ["bed"] },
  { kind: /(^|\.)(toilet|restroom|wc)$/, anyOf: ["toilet"] },
  { kind: /(^|\.)shower$/, anyOf: ["shower"] },
  { kind: /(^|\.)(kitchen|pantry)$/, anyOf: ["sink", "hob", "kitchenette"] },
  { kind: /(^|\.)gym$/, anyOf: ["treadmill", "exercise_bike", "weight_bench", "dumbbell_rack"] },
];

const STEP_MM = 50;
const COVERED = 0.8;
const SLACK_MM = 60;

const inRect = (r: Rect, x: number, y: number, slack = 0) =>
  x >= r[0] - slack && x <= r[2] + slack && y >= r[1] - slack && y <= r[3] + slack;

const axisAligned = (w: Wall) => w.a.x === w.b.x || w.a.y === w.b.y;

/** The rectangle a wall occupies, or undefined when it is not axis-aligned. */
function footprint(w: Wall): Rect | undefined {
  if (!axisAligned(w)) return undefined;
  const h = w.thicknessMm / 2;
  return [
    Math.min(w.a.x, w.b.x) - (w.a.y === w.b.y ? 0 : h),
    Math.min(w.a.y, w.b.y) - (w.a.x === w.b.x ? 0 : h),
    Math.max(w.a.x, w.b.x) + (w.a.y === w.b.y ? 0 : h),
    Math.max(w.a.y, w.b.y) + (w.a.x === w.b.x ? 0 : h),
  ];
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/\d+'\s*\d*"?\s*x\s*\d+'\s*\d*"?/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Fraction of the sample points of `r` that fall inside any of `shapes` (with a little slack). */
function covered(
  r: Rect,
  shapes: readonly Rect[],
  skip: (x: number, y: number) => boolean = () => false,
) {
  let total = 0;
  let hit = 0;
  for (let x = r[0] + STEP_MM / 2; x < r[2]; x += STEP_MM)
    for (let y = r[1] + STEP_MM / 2; y < r[3]; y += STEP_MM) {
      if (skip(x, y)) continue;
      total++;
      if (shapes.some((s) => inRect(s, x, y, SLACK_MM))) hit++;
    }
  return total === 0 ? 1 : hit / total;
}

const bounds = (s: SpatialModel["spaces"][number]) => {
  const xs = s.boundary.outer.map((v) => v.x);
  const ys = s.boundary.outer.map((v) => v.y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] as const;
};

export function auditAgainstDrawing(model: SpatialModel, evidence: DrawingEvidence): DrawingAudit {
  const findings: Finding[] = [];
  const add = (level: Finding["level"], code: string, message: string, ...ids: string[]) =>
    findings.push({ level, code, message, ids });
  const notAudited = [
    "door and window positions and swings",
    "furniture orientation and exact position",
    "anything on the sheet that is not a filled shape or text",
  ];

  const supported = [...evidence.wallRects, ...evidence.supportRects];
  const physical = model.walls.filter((w) => w.kind !== "virtual");
  const footprints = new Map<string, Rect>();
  for (const w of physical) {
    const f = footprint(w);
    if (f) footprints.set(w.id, f);
    else notAudited.push(`wall ${w.id} is not axis-aligned and was not compared`);
  }

  // 1. Every wall the model has is on the sheet. Openings leave gaps in a drawn wall, so they are skipped.
  for (const w of physical) {
    const f = footprints.get(w.id);
    if (!f) continue;
    // Openings leave gaps in a drawn wall. Measure each along the wall's own axis, from the end `a`.
    const horizontal = w.a.y === w.b.y;
    const from0 = horizontal ? w.a.x : w.a.y;
    const dir = (horizontal ? w.b.x - w.a.x : w.b.y - w.a.y) >= 0 ? 1 : -1;
    const gaps = model.openings
      .filter((o) => o.hostWallId === w.id)
      .map((o) => {
        const p = from0 + dir * o.offsetMm;
        const q = p + dir * o.widthMm;
        return [Math.min(p, q), Math.max(p, q)] as const;
      });
    const inGap = (x: number, y: number) =>
      gaps.some(([lo, hi]) => (horizontal ? x : y) > lo && (horizontal ? x : y) < hi);
    if (covered(f, supported, inGap) < COVERED)
      add("error", "wall_not_in_drawing", `wall ${w.id} is not drawn on the sheet`, w.id);
  }

  // 2. Every wall the sheet draws is in the model (as a wall, or as an obstacle that stands for it).
  const modelShapes: Rect[] = [...footprints.values()];
  for (const o of model.obstacles) {
    const xs = o.footprint.outer.map((v) => v.x);
    const ys = o.footprint.outer.map((v) => v.y);
    modelShapes.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
  }
  evidence.wallRects.forEach((r, i) => {
    if (covered(r, modelShapes) < COVERED)
      add(
        "error",
        "drawn_wall_missing",
        `the sheet draws a wall near ${Math.round((r[0] + r[2]) / 2)}, ${Math.round((r[1] + r[3]) / 2)} that the model leaves out`,
        `drawn:${i}`,
      );
  });

  // 3. Rooms are named, placed and sized as the sheet labels them.
  const rooms = evidence.labels.filter((l) => l.role === "room");
  for (const label of rooms) {
    const name = norm(label.text);
    const space = model.spaces.find((s) => norm(s.name) === name);
    if (!space) {
      add(
        "error",
        "label_without_space",
        `the sheet labels "${label.text}" but the model has no space with that name`,
      );
      continue;
    }
    const [x0, y0, x1, y1] = bounds(space);
    if (!inRect([x0, y0, x1, y1], label.at[0], label.at[1]))
      add(
        "error",
        "label_outside_space",
        `"${label.text}" is labelled at ${label.at[0]}, ${label.at[1]}, outside its space`,
        space.id,
      );
    if (label.printedSizeMm) {
      const [pw, pd] = label.printedSizeMm;
      const [w, d] = [x1 - x0, y1 - y0];
      const off = (a: number, b: number) => Math.abs(a - b) / b;
      const swapped = off(w, pd) < off(w, pw) && off(d, pw) < off(d, pd);
      const [cw, cd] = swapped ? [pd, pw] : [pw, pd];
      if (off(w, cw) > 0.1 || off(d, cd) > 0.1)
        add(
          "warn",
          "size_mismatch",
          `"${space.name}" is ${w} x ${d} mm in the model; the sheet prints ${pw} x ${pd} mm`,
          space.id,
        );
    }
  }

  // 4. A labelled space holds what that kind of space is for. A model that places no items at all (a floor plan with
  // no furniture yet) cannot be judged on this, and saying every room is empty would be false.
  if (model.items.length === 0)
    notAudited.push("what each room holds: the model has no placed items");
  for (const space of model.items.length === 0 ? [] : model.spaces) {
    for (const need of EXPECTED_CONTENTS) {
      if (!need.kind.test(space.kind)) continue;
      const has = model.items.some((i) => i.spaceId === space.id && need.anyOf.includes(i.kind));
      if (!has)
        add(
          "error",
          "space_without_expected_item",
          `"${space.name}" (${space.kind}) holds none of: ${need.anyOf.join(", ")}`,
          space.id,
        );
    }
  }

  return {
    ok: findings.every((f) => f.level !== "error"),
    findings,
    checked: {
      modelWalls: physical.length,
      drawnWalls: evidence.wallRects.length,
      roomLabels: rooms.length,
    },
    notAudited,
  };
}
