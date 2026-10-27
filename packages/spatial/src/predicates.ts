// Polygon versions of the questions the layout code asks of rectangles in `core/src/geometry.ts`:
// how much floor two rooms share, how much wall they share, whether one lies inside another.
// On rectangles they must agree with the originals (see test/predicates.test.ts); on anything else
// they are the only version that works.

import type { Pt, Region, Ring } from "./geometry";
import type { Kernel } from "./kernel";

const cross = (o: Pt, a: Pt, b: Pt) =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Length of boundary two regions have in common: collinear stretches of their edges, in millimetres. */
export function sharedBoundaryLength(a: Region, b: Region): number {
  const edges = (r: Region) =>
    r.flatMap((poly) =>
      poly.flatMap((ring: Ring) =>
        ring.map((p, i) => [p, ring[(i + 1) % ring.length] as Pt] as const),
      ),
    );
  let total = 0;
  for (const [p, q] of edges(a)) {
    const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (len === 0) continue;
    for (const [r, s] of edges(b)) {
      if (cross(p, q, r) !== 0 || cross(p, q, s) !== 0) continue; // not collinear
      const ux = (q[0] - p[0]) / len;
      const uy = (q[1] - p[1]) / len;
      const t0 = (r[0] - p[0]) * ux + (r[1] - p[1]) * uy;
      const t1 = (s[0] - p[0]) * ux + (s[1] - p[1]) * uy;
      const overlap = Math.min(len, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
      if (overlap > 0) total += overlap;
    }
  }
  return total;
}

/** True when every part of `inner` lies inside `outer` (the part outside has no area). */
export const isInside = (k: Kernel, inner: Region, outer: Region): boolean =>
  k.difference(inner, outer).length === 0;
