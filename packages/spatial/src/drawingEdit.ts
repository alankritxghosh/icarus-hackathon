// A first, bounded drawing edit: move one straight partition between two named, enclosed rooms.
// The wall rectangles are the working drawing. Re-reading them moves the door gap and rebuilds both
// room floors together, instead of shifting a rendered mesh while the plan stays where it was.
import type { DrawingEvidence, Rect } from "./drawingAudit";
import { modelFromEvidence } from "./fromDrawing";
import { sceneFromModel } from "./sceneFromModel";
import { SpatialModel } from "./schema";

export interface DrawingMove {
  evidence: DrawingEvidence;
  model: SpatialModel;
  message: string;
}

export type DrawingEditResult = { moved: DrawingMove } | { reason: string };

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/^(?:the|my|our)\s+/, "")
    .trim();
const coord = (wall: SpatialModel["walls"][number]) =>
  wall.a.x === wall.b.x ? wall.a.x : wall.a.y;

/** Refuse when the wall, rooms, or effect on the rest of the drawing cannot be identified uniquely. */
export function moveDrawingWall(
  model: SpatialModel,
  evidence: DrawingEvidence,
  request: string,
): DrawingEditResult {
  const match =
    /^move (?:the )?(?:partition )?wall between (.+?) and (.+?) (?:by )?(\d+(?:\.\d+)?)\s*(mm|cm|metres?|meters?|m) toward (.+?)[.!?]?$/i.exec(
      request.trim(),
    );
  if (!match)
    return {
      reason:
        "For this drawing, say which two rooms share the wall, how far to move it, and which room to move it toward. For example: “move the wall between kitchen and office 0.5 m toward office”.",
    };
  const [, firstName, secondName, amount, unit, towardName] = match;
  if (!firstName || !secondName || !amount || !unit || !towardName)
    return { reason: "Tell me which two rooms, how far, and which room to move toward." };
  const millimetres = Math.round(
    Number(amount) * (unit.toLowerCase() === "mm" ? 1 : unit.toLowerCase() === "cm" ? 10 : 1000),
  );
  if (millimetres < 50 || millimetres > 2000)
    return { reason: "Move that wall between 5 cm and 2 m at a time." };
  const findSpace = (name: string) => model.spaces.filter((s) => norm(s.name) === norm(name));
  const a = findSpace(firstName);
  const b = findSpace(secondName);
  if (a.length !== 1 || b.length !== 1 || a[0]?.id === b[0]?.id)
    return { reason: "I could not identify those as two different enclosed rooms in this plan." };
  const target =
    norm(towardName) === norm(firstName)
      ? a[0]
      : norm(towardName) === norm(secondName)
        ? b[0]
        : undefined;
  if (!target) return { reason: "Say which of those two rooms the wall should move toward." };
  const labels = [
    a[0] as SpatialModel["spaces"][number],
    b[0] as SpatialModel["spaces"][number],
  ].map((space) =>
    evidence.labels.filter((l) => l.role === "room" && norm(l.text) === norm(space.name)),
  );
  if (labels[0]?.length !== 1 || labels[1]?.length !== 1)
    return { reason: "I could not locate both room labels on the drawing." };
  const pa = labels[0][0]?.at;
  const pb = labels[1][0]?.at;
  if (!pa || !pb) return { reason: "I could not locate both room labels on the drawing." };

  const candidates = model.walls.filter((wall) => {
    if (wall.kind !== "interior" || wall.bulge) return false;
    const vertical = wall.a.x === wall.b.x;
    if (!vertical && wall.a.y !== wall.b.y) return false;
    const line = coord(wall);
    const near: [number, number] = vertical ? [pa[0], pb[0]] : [pa[1], pb[1]];
    const along: [number, number] = vertical ? [pa[1], pb[1]] : [pa[0], pb[0]];
    const lo = vertical ? Math.min(wall.a.y, wall.b.y) : Math.min(wall.a.x, wall.b.x);
    const hi = vertical ? Math.max(wall.a.y, wall.b.y) : Math.max(wall.a.x, wall.b.x);
    const nearSide = near[0] < near[1] ? a[0] : b[0];
    const farSide = near[0] < near[1] ? b[0] : a[0];
    if (!nearSide || !farSide) return false;
    const nearEdge = Math.max(...nearSide.boundary.outer.map((p) => (vertical ? p.x : p.y)));
    const farEdge = Math.min(...farSide.boundary.outer.map((p) => (vertical ? p.x : p.y)));
    return (
      Math.min(...near) < line - wall.thicknessMm / 2 &&
      Math.max(...near) > line + wall.thicknessMm / 2 &&
      Math.abs(nearEdge - (line - wall.thicknessMm / 2)) <= 150 &&
      Math.abs(farEdge - (line + wall.thicknessMm / 2)) <= 150 &&
      along.every((p) => p >= lo && p <= hi)
    );
  });
  if (candidates.length !== 1)
    return {
      reason: "I could not find one straight wall shared by those rooms. I left the plan alone.",
    };
  const wall = candidates[0] as SpatialModel["walls"][number];
  const vertical = wall.a.x === wall.b.x;
  const line = coord(wall);
  const targetAt = target.id === a[0]?.id ? pa : pb;
  const targetSide = (vertical ? targetAt[0] : targetAt[1]) > line ? 1 : -1;
  const shift = targetSide * millimetres;
  const newLine = line + shift;
  if ([pa, pb].some((p) => Math.abs((vertical ? p[0] : p[1]) - newLine) < 600))
    return { reason: "That would push the wall into a labelled room. I left the plan alone." };

  // Only move the filled rectangles belonging to this wall. All other ink remains where it was.
  const indices = evidence.wallRects.flatMap((rect, i) => {
    const isVertical = rect[3] - rect[1] > rect[2] - rect[0];
    const center = isVertical ? (rect[0] + rect[2]) / 2 : (rect[1] + rect[3]) / 2;
    const lo = isVertical ? rect[1] : rect[0];
    const hi = isVertical ? rect[3] : rect[2];
    const wlo = vertical ? Math.min(wall.a.y, wall.b.y) : Math.min(wall.a.x, wall.b.x);
    const whi = vertical ? Math.max(wall.a.y, wall.b.y) : Math.max(wall.a.x, wall.b.x);
    return isVertical === vertical &&
      Math.abs(center - line) <= 40 &&
      lo >= wlo - 50 &&
      hi <= whi + 50
      ? [i]
      : [];
  });
  if (!indices.length)
    return {
      reason: "I could not trace that wall back to the drawing shapes. I left the plan alone.",
    };
  const affected = new Set(indices);
  const wallRects = evidence.wallRects.map(
    (rect, i): Rect =>
      affected.has(i)
        ? vertical
          ? [rect[0] + shift, rect[1], rect[2] + shift, rect[3]]
          : [rect[0], rect[1] + shift, rect[2], rect[3] + shift]
        : rect,
  );
  const nextEvidence: DrawingEvidence = { ...evidence, wallRects };
  let next: SpatialModel;
  try {
    next = modelFromEvidence(nextEvidence, { name: model.name }).model;
  } catch {
    return { reason: "That change would leave rooms unreadable. I left the plan alone." };
  }
  const beforeRooms = new Map(model.spaces.map((s) => [s.name, s]));
  const afterRooms = new Map(next.spaces.map((s) => [s.name, s]));
  const intended = new Set([a[0]?.name, b[0]?.name]);
  if (
    beforeRooms.size !== afterRooms.size ||
    [...beforeRooms].some(([name, room]) => {
      const changed = afterRooms.get(name);
      return (
        !changed ||
        (!intended.has(name) && JSON.stringify(room.boundary) !== JSON.stringify(changed.boundary))
      );
    }) ||
    model.walls.length !== next.walls.length ||
    model.openings.length !== next.openings.length ||
    model.walls.some((old) => {
      const now = next.walls.find((w) => w.id === old.id);
      return (
        !now ||
        (old.id !== wall.id && JSON.stringify([old.a, old.b]) !== JSON.stringify([now.a, now.b]))
      );
    }) ||
    model.openings.some((old) => {
      const now = next.openings.find((o) => o.id === old.id);
      return (
        !now ||
        JSON.stringify([old.hostWallId, old.offsetMm, old.widthMm, old.kind]) !==
          JSON.stringify([now.hostWallId, now.offsetMm, now.widthMm, now.kind])
      );
    })
  )
    return { reason: "That would change another part of the drawing. I left the plan alone." };
  const parsed = SpatialModel.safeParse(next);
  if (!parsed.success) return { reason: "That change did not make a valid plan. I left it alone." };
  const generated = { source: "generated" as const, evidence: [] };
  const changedModel: SpatialModel = {
    ...parsed.data,
    walls: parsed.data.walls.map((w) => ({
      ...w,
      provenance:
        w.id === wall.id
          ? generated
          : (model.walls.find((before) => before.id === w.id)?.provenance ?? w.provenance),
    })),
    spaces: parsed.data.spaces.map((s) =>
      intended.has(s.name)
        ? { ...s, provenance: generated }
        : {
            ...s,
            provenance:
              model.spaces.find((before) => before.name === s.name)?.provenance ?? s.provenance,
          },
    ),
  };
  const furnishedBefore = new Set(sceneFromModel(model).furnished);
  const furnishedAfter = new Set(sceneFromModel(changedModel).furnished);
  const lostFurniture = [...furnishedBefore].filter((name) => !furnishedAfter.has(name));
  return {
    moved: {
      evidence: nextEvidence,
      model: changedModel,
      message: `Moved the wall between ${a[0]?.name} and ${b[0]?.name} ${Number(amount)} ${unit} toward ${target.name}. The door moved with it; other rooms stayed put.${lostFurniture.length ? ` Furniture no longer fits in ${lostFurniture.join(", ")}.` : ""} This is a concept edit; the wall's structure is unknown.`,
    },
  };
}
