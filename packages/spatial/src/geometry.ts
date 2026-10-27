// Pure geometry on integer millimetres: arcs, rings, areas, point tests. Boolean operations and
// offsetting live in kernel.ts, which wraps Clipper2.
import type { Polygon as SchemaPolygon, Vertex } from "./schema";

export type Pt = [number, number];
export type Ring = Pt[];
/** A polygon is an outer ring followed by hole rings. A region is polygons that do not overlap. */
export type Poly = Ring[];
export type Region = Poly[];

/** Points along the arc from p to q with the given bulge, sagitta error at most `tolMm`. */
export function flattenEdge(
  p: Vertex,
  q: { x: number; y: number },
  bulge: number,
  tolMm: number,
): Pt[] {
  if (!bulge) return [[p.x, p.y]];
  const theta = 4 * Math.atan(bulge); // signed included angle
  const chord = Math.hypot(q.x - p.x, q.y - p.y);
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  const step = 2 * Math.acos(Math.max(0, 1 - tolMm / r));
  const n = Math.max(2, Math.ceil(Math.abs(theta) / Math.max(step, 1e-3)));
  // The centre lies on the perpendicular bisector, to the left of a->b for a counter-clockwise arc.
  const nx = -(q.y - p.y) / chord;
  const ny = (q.x - p.x) / chord;
  const off = Math.sign(bulge) * r * Math.cos(Math.abs(theta) / 2);
  const cx = (p.x + q.x) / 2 + nx * off;
  const cy = (p.y + q.y) / 2 + ny * off;
  const a0 = Math.atan2(p.y - cy, p.x - cx);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (theta * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

/** The ring as integer points; curves become segments within `tolMm`, then snap to the grid. */
export function flattenRing(ring: Vertex[], tolMm = 2): Ring {
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as Vertex;
    const q = ring[(i + 1) % ring.length] as Vertex;
    for (const [x, y] of flattenEdge(p, q, p.bulge ?? 0, tolMm)) {
      const pt: Pt = [Math.round(x), Math.round(y)];
      const last = out[out.length - 1];
      if (!last || last[0] !== pt[0] || last[1] !== pt[1]) out.push(pt);
    }
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first && last && out.length > 1 && first[0] === last[0] && first[1] === last[1]) out.pop();
  return out;
}

export const signedArea = (r: Ring): number => {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i] as Pt;
    const [x2, y2] = r[(i + 1) % r.length] as Pt;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
};

export const toRegion = (p: SchemaPolygon, tolMm = 2): Region => [
  [flattenRing(p.outer, tolMm), ...p.holes.map((h) => flattenRing(h, tolMm))],
];

/** Area in square millimetres: outers minus holes. Winding is not trusted. */
export const regionArea = (region: Region): number =>
  region.reduce(
    (a, poly) =>
      a + poly.reduce((b, ring, i) => b + (i === 0 ? 1 : -1) * Math.abs(signedArea(ring)), 0),
    0,
  );

const cross = (o: Pt, a: Pt, b: Pt) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when no two non-adjacent edges properly cross. O(n^2): meant for room-sized rings. */
export function isSimple(ring: Ring): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (
        segmentsCross(
          ring[i] as Pt,
          ring[(i + 1) % n] as Pt,
          ring[j] as Pt,
          ring[(j + 1) % n] as Pt,
        )
      )
        return false;
    }
  return true;
}

/** Drops repeated points and points that lie on the line between their neighbours (exact on integers). */
export function cleanRing(ring: Ring): Ring {
  let cur = ring.filter((p, i) => {
    const prev = ring[(i + ring.length - 1) % ring.length] as Pt;
    return p[0] !== prev[0] || p[1] !== prev[1];
  });
  let changed = true;
  while (changed && cur.length > 3) {
    changed = false;
    const next: Ring = [];
    for (let i = 0; i < cur.length; i++) {
      const prev = cur[(i + cur.length - 1) % cur.length] as Pt;
      const here = cur[i] as Pt;
      const after = cur[(i + 1) % cur.length] as Pt;
      if (cross(prev, here, after) === 0) changed = true;
      else next.push(here);
    }
    cur = next;
  }
  return cur;
}

export const wallLength = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  bulge = 0,
): number => {
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (!bulge) return chord;
  const theta = 4 * Math.atan(bulge);
  return Math.abs(theta) * (chord / (2 * Math.sin(Math.abs(theta) / 2)));
};

/** Ray-casting point test against a region (outer ring minus holes). */
export function pointInRegion(region: Region, x: number, y: number): boolean {
  const inRing = (ring: Ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i] as Pt;
      const [xj, yj] = ring[j] as Pt;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  return region.some((poly) => inRing(poly[0] as Ring) && !poly.slice(1).some(inRing));
}

export const boundsOf = (region: Region) => {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const poly of region)
    for (const [x, y] of poly[0] ?? []) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return { x0, y0, x1, y1 };
};
