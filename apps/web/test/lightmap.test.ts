import { describe, expect, it } from "vitest";
import { boxLightmap } from "../src/lightmap";

/** Each face's rectangle in texels, read back from the coordinates alone. */
function faceRects(uv: Float32Array, side: number) {
  const rects = [];
  for (let f = 0; f < 6; f++) {
    const us = [0, 1, 2, 3].map((c) => (uv[(f * 4 + c) * 2] ?? 0) * side);
    const vs = [0, 1, 2, 3].map((c) => (uv[(f * 4 + c) * 2 + 1] ?? 0) * side);
    rects.push({
      x0: Math.min(...us),
      x1: Math.max(...us),
      y0: Math.min(...vs),
      y1: Math.max(...vs),
    });
  }
  return rects;
}

describe("boxLightmap", () => {
  // A long wall, a big floor slab, a door leaf and a thin frame member: the shapes the bake gets.
  const boxes: [number, number, number][] = [
    [24, 3, 0.1],
    [18, 0.05, 9.4],
    [0.9, 2.1, 0.04],
    [0.05, 2.1, 0.05],
  ];
  for (const [sx, sy, sz] of boxes)
    it(`keeps every face of a ${sx} x ${sy} x ${sz} m box inside the texture and apart`, () => {
      const { uv, side } = boxLightmap(sx, sy, sz);
      expect(side).toBeGreaterThanOrEqual(32);
      expect(side).toBeLessThanOrEqual(1024);
      const rects = faceRects(uv, side);
      for (const r of rects) {
        expect(r.x0).toBeGreaterThanOrEqual(1);
        expect(r.y0).toBeGreaterThanOrEqual(1);
        expect(r.x1).toBeLessThanOrEqual(side - 1);
        expect(r.y1).toBeLessThanOrEqual(side - 1);
      }
      for (let a = 0; a < 6; a++)
        for (let b = a + 1; b < 6; b++) {
          const p = rects[a];
          const q = rects[b];
          if (!p || !q) throw new Error("missing face");
          // At least two texels of empty space between any two faces.
          const apart =
            p.x1 + 2 <= q.x0 || q.x1 + 2 <= p.x0 || p.y1 + 2 <= q.y0 || q.y1 + 2 <= p.y0;
          expect(apart, `faces ${a} and ${b}`).toBe(true);
        }
    });

  it("keeps a face's proportions, so light is not stretched", () => {
    const { uv, side } = boxLightmap(24, 3, 0.1);
    const front = faceRects(uv, side)[4];
    if (!front) throw new Error("no front face");
    const ratio = (front.x1 - front.x0) / (front.y1 - front.y0);
    expect(ratio).toBeGreaterThan(24 / 3 - 0.6);
    expect(ratio).toBeLessThan(24 / 3 + 0.6);
  });
});
