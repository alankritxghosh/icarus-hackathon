import { inside, overlapArea, type Rect, sharedEdge } from "@icarus/core";
import { beforeAll, describe, expect, it } from "vitest";
import { isInside, type Kernel, type Region, sharedBoundaryLength } from "../src";
import { testKernel } from "./kernelSetup";

let k: Kernel;
beforeAll(async () => {
  k = await testKernel();
});

// Differential test: the polygon predicates against the original rectangle functions, on random
// rectangles chosen on a coarse grid so edges touch and coincide constantly. Coordinates are whole
// millimetres, which is exactly representable in metres to the precision the originals use.
const rng = (start: number) => {
  let state = start;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};
const rnd = rng(4242);
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const toRegion = (r: Rect): Region => {
  const [x0, y0, x1, y1] = [
    Math.round(r.x * 1000),
    Math.round(r.y * 1000),
    Math.round((r.x + r.w) * 1000),
    Math.round((r.y + r.h) * 1000),
  ];
  return [
    [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
      ],
    ],
  ];
};
const random = (): Rect => ({
  x: ri(0, 10) * 1.5,
  y: ri(0, 10) * 1.5,
  w: ri(1, 6) * 1.5,
  h: ri(1, 6) * 1.5,
});

describe("polygon predicates agree with the rectangle functions", () => {
  it("overlap area, on 2000 random pairs", () => {
    for (let i = 0; i < 2000; i++) {
      const a = random();
      const b = random();
      expect(k.overlapArea(toRegion(a), toRegion(b)) / 1e6).toBeCloseTo(overlapArea(a, b), 9);
    }
  });

  it("shared wall length for rooms that do not overlap, on 2000 random pairs", () => {
    let touching = 0;
    for (let i = 0; i < 2000; i++) {
      const a = random();
      const b = random();
      if (overlapArea(a, b) > 0) continue;
      const want = sharedEdge(a, b);
      if (want > 0) touching++;
      expect(sharedBoundaryLength(toRegion(a), toRegion(b)) / 1000).toBeCloseTo(want, 9);
    }
    expect(touching).toBeGreaterThan(100); // the grid really does produce shared walls
  });

  it("containment, on 2000 random pairs", () => {
    let contained = 0;
    for (let i = 0; i < 2000; i++) {
      const a = random();
      const b = { x: ri(0, 8) * 1.5, y: ri(0, 8) * 1.5, w: ri(1, 14) * 1.5, h: ri(1, 14) * 1.5 };
      const want = inside(a, b);
      if (want) contained++;
      expect(isInside(k, toRegion(a), toRegion(b))).toBe(want);
    }
    expect(contained).toBeGreaterThan(50);
  });

  it("and they work where the originals cannot: an L-shaped room", () => {
    const L: Region = [
      [
        [
          [0, 0],
          [10000, 0],
          [10000, 4000],
          [4000, 4000],
          [4000, 8000],
          [0, 8000],
        ],
      ],
    ];
    const leg: Region = [
      [
        [
          [0, 4000],
          [4000, 4000],
          [4000, 8000],
          [0, 8000],
        ],
      ],
    ];
    const arm: Region = [
      [
        [
          [4000, 0],
          [10000, 0],
          [10000, 4000],
          [4000, 4000],
        ],
      ],
    ];
    expect(isInside(k, leg, L)).toBe(true);
    expect(
      isInside(
        k,
        [
          [
            [
              [3000, 3000],
              [5000, 3000],
              [5000, 5000],
              [3000, 5000],
            ],
          ],
        ],
        L,
      ),
    ).toBe(false); // pokes into the notch
    expect(sharedBoundaryLength(leg, arm)).toBe(0); // they meet only at the corner point (4000, 4000)
    expect(sharedBoundaryLength(L, leg)).toBe(12000); // the leg's west, south and east walls
  });
});
