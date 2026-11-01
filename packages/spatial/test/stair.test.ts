import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, SpatialModel, sceneFromModel } from "../src";

const rect = (x0: number, y0: number, x1: number, y1: number) => ({
  outer: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
  holes: [],
});

const provenance = { source: "estimated" as const, evidence: ["hand-drawn-fixture"] };

function twoLevelStair() {
  return SpatialModel.parse({
    schema: SCHEMA_VERSION,
    units: "mm",
    name: "Known stair fixture",
    levels: [
      {
        id: "lower",
        name: "Lower",
        elevationMm: 0,
        heightMm: 3200,
        boundary: rect(0, 0, 8000, 2000),
      },
      {
        id: "upper",
        name: "Upper",
        elevationMm: 3200,
        heightMm: 3200,
        boundary: rect(0, 0, 8000, 2000),
      },
    ],
    spaces: [
      {
        id: "entry",
        levelId: "lower",
        kind: "circulation.hall",
        name: "Entry",
        boundary: rect(0, 0, 1200, 2000),
        provenance,
      },
      {
        id: "arrival",
        levelId: "upper",
        kind: "circulation.hall",
        name: "Arrival",
        boundary: rect(5800, 0, 8000, 2000),
        provenance,
      },
    ],
    walls: [],
    openings: [],
    connectors: [
      {
        id: "stair",
        kind: "stair",
        serves: [
          { levelId: "lower", footprint: rect(800, 600, 6200, 1400) },
          { levelId: "upper", footprint: rect(800, 600, 6200, 1400) },
        ],
        clearWidthMm: 800,
        path: [
          { x: 1000, y: 1000, elevationMm: 0, stepsToNext: 20 },
          { x: 6000, y: 1000, elevationMm: 3200 },
        ],
        provenance,
      },
    ],
  });
}

describe("model-derived walkable stair", () => {
  it("connects two floor surfaces with twenty 160 mm rises and no gap in a hand-measured route", () => {
    const scene = sceneFromModel(twoLevelStair()).scene;
    const treads = scene.nodes.filter(
      (node) => node.type === "floor" && node.tags.includes("stair"),
    );
    expect(treads).toHaveLength(20);
    expect(scene.nodes.filter((node) => node.tags.includes("riser"))).toHaveLength(20);
    expect(scene.nodes.filter((node) => node.tags.includes("rail"))).toHaveLength(40);
    expect(treads.map((node) => Math.round((node.position[1] + 0.06) * 1000))).toEqual(
      Array.from({ length: 20 }, (_, i) => (i + 1) * 160),
    );
    const floors = scene.nodes.filter(
      (node) => node.type === "floor" && node.geometry.kind === "box",
    );
    let height = 0;
    for (let x = 0.9; x <= 6.2; x += 0.1) {
      const reachable = floors.filter((floor) => {
        if (floor.geometry.kind !== "box") return false;
        const top = floor.position[1] + floor.geometry.size[1] / 2;
        return (
          Math.abs(x - floor.position[0]) <= floor.geometry.size[0] / 2 + 0.1 &&
          Math.abs(1 - floor.position[2]) <= floor.geometry.size[2] / 2 + 0.1 &&
          top <= height + 0.22 &&
          top >= height - 0.3
        );
      });
      expect(reachable.length, `no supporting surface at x=${x.toFixed(1)}`).toBeGreaterThan(0);
      height = Math.max(
        ...reachable.map(
          (floor) =>
            floor.position[1] + (floor.geometry.kind === "box" ? floor.geometry.size[1] / 2 : 0),
        ),
      );
    }
    expect(height).toBeCloseTo(3.2, 3);
  });

  it("rejects a flight whose rises are too high for the walking step", () => {
    const model = twoLevelStair();
    model.connectors[0]!.path![0]!.stepsToNext = 10;
    expect(() => sceneFromModel(model)).toThrow("unwalkable flight segment");
  });

  it("keeps a source opening passable and a sealed wall impassable beside the stair", () => {
    const model = twoLevelStair();
    model.walls.push({
      id: "entry-wall",
      levelId: "lower",
      a: { x: 900, y: 0 },
      b: { x: 900, y: 2000 },
      thicknessMm: 120,
      kind: "interior",
      structural: "unknown",
      glazed: false,
      provenance,
    });
    model.openings.push({
      id: "entry-door",
      hostWallId: "entry-wall",
      kind: "passage",
      offsetMm: 600,
      widthMm: 800,
      sillMm: 0,
      headMm: 2100,
      entrance: true,
      provenance,
    });
    const blocks = (x: number, z: number) =>
      sceneFromModel(model).scene.nodes.some((node) => {
        if (node.type !== "wall" || node.geometry.kind !== "box") return false;
        if (node.position[1] - node.geometry.size[1] / 2 > 1.6) return false;
        const dx = x - node.position[0],
          dz = z - node.position[2];
        const c = Math.cos(node.rotationY),
          s = Math.sin(node.rotationY);
        return (
          Math.abs(c * dx - s * dz) < node.geometry.size[0] / 2 + 0.2 &&
          Math.abs(s * dx + c * dz) < node.geometry.size[2] / 2 + 0.2
        );
      });
    expect(blocks(0.9, 1)).toBe(false);
    expect(blocks(0.9, 0.2)).toBe(true);
    model.openings = [];
    expect(blocks(0.9, 1)).toBe(true);
  });
});
