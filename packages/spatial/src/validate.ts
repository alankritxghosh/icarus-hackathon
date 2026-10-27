// Structural and geometric validation of a spatial model. Circulation and uncertainty summaries are
// in their own files.
import type { Region } from "./geometry";
import {
  flattenRing,
  isSimple,
  pointInRegion,
  regionArea,
  signedArea,
  toRegion,
  wallLength,
} from "./geometry";
import type { Kernel } from "./kernel";
import { SpatialModel } from "./schema";

export interface Finding {
  level: "error" | "warn";
  code: string;
  message: string;
  ids: string[];
}

export const AREA_TOLERANCE_MM2 = 20_000; // 0.02 m2: rounding noise, not a real overlap
const MIN_DOOR_CLEAR_MM = 815; // ADA 404.2.3 floor, as in the v1 knowledge file; not a compliance claim

export function validate(
  input: unknown,
  kernel: Kernel,
): { model?: SpatialModel; findings: Finding[] } {
  const parsed = SpatialModel.safeParse(input);
  if (!parsed.success)
    return {
      findings: parsed.error.issues.map((i) => ({
        level: "error",
        code: "schema",
        message: `${i.path.join(".")}: ${i.message}`,
        ids: [],
      })),
    };
  const m = parsed.data;
  const differenceArea = (a: Region, b: Region) => regionArea(kernel.difference(a, b));
  const intersectArea = (a: Region, b: Region) => kernel.overlapArea(a, b);
  const f: Finding[] = [];
  const err = (code: string, message: string, ...ids: string[]) =>
    f.push({ level: "error", code, message, ids });
  const warn = (code: string, message: string, ...ids: string[]) =>
    f.push({ level: "warn", code, message, ids });

  const ids = new Map<string, string>();
  const claim = (kind: string, id: string) => {
    if (ids.has(id))
      err("duplicate_id", `${kind} ${id} reuses an id already used by a ${ids.get(id)}`, id);
    ids.set(id, kind);
  };
  for (const l of m.levels) claim("level", l.id);
  for (const s of m.spaces) claim("space", s.id);
  for (const w of m.walls) claim("wall", w.id);
  for (const o of m.openings) claim("opening", o.id);
  for (const o of m.obstacles) claim("obstacle", o.id);
  for (const c of m.connectors) claim("connector", c.id);
  for (const i of m.items) claim("item", i.id);

  const level = new Map(m.levels.map((l) => [l.id, l]));
  const space = new Map(m.spaces.map((s) => [s.id, s]));
  const wall = new Map(m.walls.map((w) => [w.id, w]));

  const ringOk = (
    what: string,
    id: string,
    ring: { x: number; y: number; bulge?: number }[],
    wantCcw: boolean,
  ) => {
    const flat = flattenRing(ring);
    const a = signedArea(flat);
    if (Math.abs(a) < 1) err("degenerate_ring", `${what} ${id} has zero area`, id);
    else if (a > 0 !== wantCcw)
      err(
        "wrong_winding",
        `${what} ${id}: ${wantCcw ? "outer rings run counter-clockwise" : "holes run clockwise"}`,
        id,
      );
    if (!isSimple(flat)) err("self_intersecting", `${what} ${id} crosses itself`, id);
  };

  for (const l of m.levels) {
    ringOk("level", l.id, l.boundary.outer, true);
    for (const h of l.boundary.holes) ringOk("level hole in", l.id, h, false);
  }
  for (const s of m.spaces) {
    const lvl = level.get(s.levelId);
    if (!lvl) {
      err("missing_level", `space ${s.id} is on unknown level ${s.levelId}`, s.id);
      continue;
    }
    ringOk("space", s.id, s.boundary.outer, true);
    for (const h of s.boundary.holes) ringOk("space hole in", s.id, h, false);
    const outside = differenceArea(toRegion(s.boundary), toRegion(lvl.boundary));
    if (outside > AREA_TOLERANCE_MM2)
      err(
        "outside_level",
        `space ${s.id} extends ${(outside / 1e6).toFixed(2)} m2 outside its level`,
        s.id,
      );
  }

  // Spaces on the same level must not overlap.
  const byLevel = new Map<string, typeof m.spaces>();
  for (const s of m.spaces) byLevel.set(s.levelId, [...(byLevel.get(s.levelId) ?? []), s]);
  for (const list of byLevel.values()) {
    for (let i = 0; i < list.length; i++)
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (!a || !b) continue;
        const o = intersectArea(toRegion(a.boundary), toRegion(b.boundary));
        if (o > AREA_TOLERANCE_MM2)
          err(
            "spaces_overlap",
            `${a.id} and ${b.id} overlap by ${(o / 1e6).toFixed(2)} m2`,
            a.id,
            b.id,
          );
      }
  }

  for (const o of m.obstacles) {
    const l = level.get(o.levelId);
    if (!l) {
      err("missing_level", `obstacle ${o.id} is on unknown level ${o.levelId}`, o.id);
      continue;
    }
    const out = differenceArea(toRegion(o.footprint), toRegion(l.boundary));
    if (out > AREA_TOLERANCE_MM2)
      err("outside_level", `obstacle ${o.id} lies outside its level`, o.id);
  }

  for (const w of m.walls) {
    if (!level.has(w.levelId))
      err("missing_level", `wall ${w.id} is on unknown level ${w.levelId}`, w.id);
    for (const side of [w.left, w.right]) {
      if (side && side !== "exterior" && !space.has(side))
        err("missing_space", `wall ${w.id} names unknown space ${side}`, w.id);
      if (side && side !== "exterior" && space.get(side)?.levelId !== w.levelId)
        err("wrong_level", `wall ${w.id} borders ${side} on another level`, w.id);
    }
    if (wallLength(w.a, w.b, w.bulge) < w.thicknessMm)
      warn("short_wall", `wall ${w.id} is shorter than it is thick`, w.id);
    // Left and right must be true: probe a point just off each face of a straight wall.
    const lvl = level.get(w.levelId);
    if (lvl && !w.bulge) {
      const len = wallLength(w.a, w.b);
      const nx = -(w.b.y - w.a.y) / len,
        ny = (w.b.x - w.a.x) / len;
      const mx = (w.a.x + w.b.x) / 2,
        my = (w.a.y + w.b.y) / 2;
      const probe = w.thicknessMm / 2 + 20;
      for (const [side, sign] of [
        [w.left, 1],
        [w.right, -1],
      ] as const) {
        if (!side) continue;
        const px = mx + nx * probe * sign,
          py = my + ny * probe * sign;
        const hit =
          side === "exterior"
            ? !pointInRegion(toRegion(lvl.boundary), px, py)
            : (() => {
                const sp = space.get(side);
                return !!sp && pointInRegion(toRegion(sp.boundary), px, py);
              })();
        if (!hit)
          err(
            "wrong_side",
            `wall ${w.id}: ${side} is not on its ${sign === 1 ? "left" : "right"}`,
            w.id,
          );
      }
    }
  }

  // Openings sit inside their wall, do not overlap each other, and doors are wide enough.
  const onWall = new Map<string, typeof m.openings>();
  for (const o of m.openings) {
    const w = wall.get(o.hostWallId);
    if (!w) {
      err("missing_wall", `opening ${o.id} is hosted on unknown wall ${o.hostWallId}`, o.id);
      continue;
    }
    onWall.set(w.id, [...(onWall.get(w.id) ?? []), o]);
    if (o.offsetMm + o.widthMm > wallLength(w.a, w.b, w.bulge) + 1)
      err("opening_outside_wall", `opening ${o.id} runs past the end of wall ${w.id}`, o.id, w.id);
    if (o.kind === "door" && o.widthMm < MIN_DOOR_CLEAR_MM)
      warn(
        "narrow_door",
        `door ${o.id} is ${o.widthMm} mm clear, under ${MIN_DOOR_CLEAR_MM} mm`,
        o.id,
      );
  }
  for (const [wid, list] of onWall) {
    const sorted = [...list].sort((a, b) => a.offsetMm - b.offsetMm);
    for (let i = 1; i < sorted.length; i++)
      if (
        (sorted[i] as (typeof list)[0]).offsetMm <
        (sorted[i - 1] as (typeof list)[0]).offsetMm + (sorted[i - 1] as (typeof list)[0]).widthMm
      )
        err(
          "openings_overlap",
          `openings ${(sorted[i - 1] as (typeof list)[0]).id} and ${(sorted[i] as (typeof list)[0]).id} overlap on wall ${wid}`,
          wid,
        );
  }

  for (const c of m.connectors)
    for (const s of c.serves)
      if (!level.has(s.levelId))
        err("missing_level", `connector ${c.id} serves unknown level ${s.levelId}`, c.id);
  for (const it of m.items)
    if (!space.has(it.spaceId))
      err("missing_space", `item ${it.id} is in unknown space ${it.spaceId}`, it.id);

  return { model: m, findings: f };
}

/** Usable floor of a space: its polygon minus the obstacles standing in it. */
export function usableAreaM2(m: SpatialModel, spaceId: string, kernel: Kernel): number {
  const s = m.spaces.find((x) => x.id === spaceId);
  if (!s) return 0;
  const obs = kernel.unionAll(
    m.obstacles.filter((o) => o.levelId === s.levelId).map((o) => toRegion(o.footprint)),
  );
  return (
    (regionArea(toRegion(s.boundary)) -
      (obs.length ? kernel.overlapArea(toRegion(s.boundary), obs) : 0)) /
    1e6
  );
}
