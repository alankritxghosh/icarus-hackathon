/** Plan coordinates in metres: x runs east, y runs south, the origin is the north-west corner. */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Side = "north" | "south" | "east" | "west";
export const SIDES: readonly Side[] = ["north", "south", "east", "west"];

export const area = (r: Rect) => r.w * r.h;
export const right = (r: Rect) => r.x + r.w;
export const bottom = (r: Rect) => r.y + r.h;
export const centre = (r: Rect): [number, number] => [r.x + r.w / 2, r.y + r.h / 2];

const EPS = 1e-6;

/** Overlapping area of two rectangles (touching edges overlap by zero). */
export function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
  const h = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  return w > EPS && h > EPS ? w * h : 0;
}

/** Length of wall two rectangles share along an edge, or 0 if they do not touch edge to edge. */
export function sharedEdge(a: Rect, b: Rect): number {
  const vertical = Math.abs(right(a) - b.x) < EPS || Math.abs(right(b) - a.x) < EPS;
  if (vertical) {
    const len = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
    if (len > EPS) return len;
  }
  const horizontal = Math.abs(bottom(a) - b.y) < EPS || Math.abs(bottom(b) - a.y) < EPS;
  if (horizontal) {
    const len = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
    if (len > EPS) return len;
  }
  return 0;
}

export const inside = (inner: Rect, outer: Rect) =>
  inner.x >= outer.x - EPS &&
  inner.y >= outer.y - EPS &&
  right(inner) <= right(outer) + EPS &&
  bottom(inner) <= bottom(outer) + EPS;

/** Length of the rectangle's edge that lies on the given side of the shell. */
export function exposureOnSide(r: Rect, shell: { w: number; h: number }, side: Side): number {
  if (side === "west") return r.x < EPS ? r.h : 0;
  if (side === "east") return Math.abs(right(r) - shell.w) < EPS ? r.h : 0;
  if (side === "north") return r.y < EPS ? r.w : 0;
  return Math.abs(bottom(r) - shell.h) < EPS ? r.w : 0;
}

export const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Span, in metres, over which two rectangles face each other with at most `maxGap` between them
 * (touching counts). Rooms on either side of a corridor face each other; rooms in different rows
 * with a room between them do not. Overlapping rectangles return 0.
 */
export function facingSpan(a: Rect, b: Rect, maxGap: number): number {
  if (overlapArea(a, b) > 0) return 0;
  const gapX = Math.max(a.x, b.x) - Math.min(right(a), right(b));
  const spanY = Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y);
  const gapY = Math.max(a.y, b.y) - Math.min(bottom(a), bottom(b));
  const spanX = Math.min(right(a), right(b)) - Math.max(a.x, b.x);
  let best = 0;
  if (gapX >= -EPS && gapX <= maxGap + EPS && spanY > EPS) best = Math.max(best, spanY);
  if (gapY >= -EPS && gapY <= maxGap + EPS && spanX > EPS) best = Math.max(best, spanX);
  return best;
}
