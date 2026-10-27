// Geometry helpers for the draft v2 model: arc flattening, areas, simplicity, region algebra.
import polygonClipping from "polygon-clipping";
import type { Polygon, Vertex } from "./spatial.ts";

type Pt = [number, number];
type Ring = Pt[];
export type Region = Ring[][];

/** Points along the arc from p to q with the given bulge; sagitta error at most `tolMm`. */
export function flattenEdge(p: Vertex, q: { x: number; y: number }, bulge: number, tolMm = 5): Pt[] {
  if (!bulge) return [[p.x, p.y]];
  const theta = 4 * Math.atan(bulge); // signed included angle
  const chord = Math.hypot(q.x - p.x, q.y - p.y);
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  // largest step whose sagitta stays within tolerance
  const step = 2 * Math.acos(Math.max(0, 1 - tolMm / r));
  const n = Math.max(2, Math.ceil(Math.abs(theta) / Math.max(step, 1e-3)));
  const mx = (p.x + q.x) / 2;
  const my = (p.y + q.y) / 2;
  const h = r * Math.cos(Math.abs(theta) / 2) * Math.sign(bulge) * -1; // centre offset from the chord midpoint
  const nx = -(q.y - p.y) / chord;
  const ny = (q.x - p.x) / chord;
  const cx = mx + nx * h * -1;
  const cy = my + ny * h * -1;
  const a0 = Math.atan2(p.y - cy, p.x - cx);
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = a0 + (theta * i) / n;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

export function flattenRing(ring: Vertex[], tolMm = 5): Ring {
  const out: Ring = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i] as Vertex;
    const q = ring[(i + 1) % ring.length] as Vertex;
    out.push(...flattenEdge(p, q, p.bulge ?? 0, tolMm));
  }
  return out;
}

export const signedArea = (r: Ring) => {
  let s = 0;
  for (let i = 0; i < r.length; i++) {
    const [x1, y1] = r[i] as Pt;
    const [x2, y2] = r[(i + 1) % r.length] as Pt;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
};

export const toRegion = (p: Polygon, tolMm = 5): Region => [
  [flattenRing(p.outer, tolMm), ...p.holes.map((h) => flattenRing(h, tolMm))],
];

export const regionArea = (r: Region) =>
  r.reduce((a, poly) => a + poly.reduce((b, ring, i) => b + (i === 0 ? 1 : -1) * Math.abs(signedArea(ring)), 0), 0);

export const intersectArea = (a: Region, b: Region) => regionArea(polygonClipping.intersection(a as never, b as never) as Region);
export const differenceArea = (a: Region, b: Region) => regionArea(polygonClipping.difference(a as never, b as never) as Region);
export const unionRegions = (rs: Region[]) => (rs.length ? (polygonClipping.union(rs[0] as never, ...(rs.slice(1) as never[])) as Region) : []);

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(a, b, c), d2 = cross(a, b, d), d3 = cross(c, d, a), d4 = cross(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** True when no two non-adjacent edges of the flattened ring properly cross. */
export function isSimple(ring: Ring): boolean {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(ring[i] as Pt, ring[(i + 1) % n] as Pt, ring[j] as Pt, ring[(j + 1) % n] as Pt)) return false;
    }
  }
  return true;
}

export const wallLength = (a: { x: number; y: number }, b: { x: number; y: number }, bulge = 0) => {
  const chord = Math.hypot(b.x - a.x, b.y - a.y);
  if (!bulge) return chord;
  const theta = 4 * Math.atan(bulge);
  const r = chord / (2 * Math.sin(Math.abs(theta) / 2));
  return Math.abs(theta) * r;
};

/** Ray-casting point test against a region (outer ring minus holes), on flattened rings. */
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
