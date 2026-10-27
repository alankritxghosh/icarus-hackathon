import { beforeAll, describe, expect, it } from "vitest";
import { boundsOf, type Region, regionArea, toRegion } from "../src/geometry";
import type { Kernel } from "../src/kernel";
import { testKernel } from "./kernelSetup";

let k: Kernel;
beforeAll(async () => {
  k = await testKernel();
});

const rect = (x: number, y: number, w: number, h: number): Region => [
  [
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
  ],
];
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

const rng = (start: number) => {
  let state = start;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
};
const rnd = rng(99);
const ri = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));

describe("kernel", () => {
  it("matches the analytic area of random rectangle pairs exactly", () => {
    for (let i = 0; i < 400; i++) {
      const a = [ri(0, 15000), ri(0, 15000), ri(500, 8000), ri(500, 8000)] as const;
      const b = [ri(0, 15000), ri(0, 15000), ri(500, 8000), ri(500, 8000)] as const;
      const ow = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
      const oh = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
      const A = rect(...a);
      const B = rect(...b);
      expect(regionArea(k.intersection(A, B))).toBe(ow * oh);
      expect(regionArea(k.union(A, B))).toBe(a[2] * a[3] + b[2] * b[3] - ow * oh);
      expect(regionArea(k.difference(A, B))).toBe(a[2] * a[3] - ow * oh);
    }
  });

  it("merges 36 abutting rooms into one four-vertex polygon", () => {
    const rooms = Array.from({ length: 36 }, (_, n) =>
      rect((n % 6) * 3000, Math.floor(n / 6) * 3000, 3000, 3000),
    );
    const all = k.unionAll(rooms);
    expect(all).toHaveLength(1);
    expect(all[0]?.[0]).toHaveLength(4);
    expect(regionArea(all)).toBe(18000 * 18000);
  });

  it("keeps a 1 mm gap and a shared wall apart; float noise snaps to the grid", () => {
    expect(k.union(rect(0, 0, 4000, 3000), rect(4000, 0, 4000, 3000))).toHaveLength(1);
    expect(k.union(rect(0, 0, 4000, 3000), rect(4001, 0, 4000, 3000))).toHaveLength(2);
    // A shared wall that differs by a nanometre in float input becomes the same wall once rounded.
    const noisy = toRegion({
      outer: [
        { x: 4000.000001, y: 0 },
        { x: 8000, y: 0 },
        { x: 8000, y: 3000 },
        { x: 4000.000001, y: 3000 },
      ],
      holes: [],
    });
    expect(k.union(rect(0, 0, 4000, 3000), noisy)).toHaveLength(1);
  });

  it("returns holes with the outer ring they belong to", () => {
    const out = k.difference(rect(0, 0, 6000, 6000), rect(2500, 2500, 1000, 1000));
    expect(out).toHaveLength(1);
    expect(out[0]).toHaveLength(2);
    expect(regionArea(out)).toBe(35_000_000);
    // an island inside the hole is a second polygon
    const island = k.union(out, rect(2800, 2800, 400, 400));
    expect(island).toHaveLength(2);
    expect(regionArea(island)).toBe(35_000_000 + 160_000);
  });

  it("offsets an L exactly and empties a strip that is too thin", () => {
    expect(regionArea(k.offset(L, 100))).toBe(10200 * 4200 + 4200 * 4000);
    expect(regionArea(k.offset(L, -100))).toBe(9800 * 3800 + 3800 * 4000);
    expect(k.offset(rect(0, 0, 150, 3000), -100)).toEqual([]);
    // a hole shrinks when the region grows
    const holed = k.difference(rect(0, 0, 6000, 6000), rect(2500, 2500, 1000, 1000));
    expect(regionArea(k.offset(holed, 100))).toBe(6200 * 6200 - 800 * 800);
  });

  it("survives degenerate input that crashes other libraries", () => {
    const spike: Region = [
      [
        [
          [0, 0],
          [4000, 0],
          [4000, 3000],
          [2000, 3000],
          [2000, 6000],
          [2000, 3000],
          [0, 3000],
        ],
      ],
    ];
    expect(regionArea(k.union(spike, rect(10000, 10000, 1000, 1000)))).toBe(12_000_000 + 1_000_000);
    const bow: Region = [
      [
        [
          [0, 0],
          [4000, 3000],
          [4000, 0],
          [0, 3000],
        ],
      ],
    ];
    expect(() => k.union(bow, rect(10000, 10000, 1000, 1000))).not.toThrow();
  });

  it("obeys inclusion-exclusion on a coarse grid where edges coincide constantly", () => {
    const shape = () => {
      const g = () => rect(ri(0, 10) * 1000, ri(0, 10) * 1000, ri(1, 6) * 1000, ri(1, 6) * 1000);
      return k.union(k.union(g(), g()), g());
    };
    for (let i = 0; i < 300; i++) {
      const A = shape();
      const B = shape();
      const a = regionArea(A);
      const b = regionArea(B);
      const n = regionArea(k.intersection(A, B));
      expect(regionArea(k.union(A, B))).toBe(a + b - n);
      expect(regionArea(k.difference(A, B))).toBe(a - n);
      const bb = boundsOf(A);
      expect(bb.x1).toBeGreaterThan(bb.x0);
    }
  });

  it("does not leak native memory across many operations", () => {
    const before = process.memoryUsage().rss;
    for (let i = 0; i < 20000; i++) k.union(L, rect(i % 5000, 0, 3000, 3000));
    const grew = (process.memoryUsage().rss - before) / 1e6;
    expect(grew).toBeLessThan(150);
  });
});
