import { beforeAll, describe, expect, it } from "vitest";
import {
  circulationGraph,
  fromFloorPlan,
  GENERATED,
  type Kernel,
  regionArea,
  type SpatialModel,
  toRegion,
  uncertaintySummary,
  usableAreaM2,
  type Vertex,
  validate,
} from "../src";
import { plans } from "./fixtures";
import { testKernel } from "./kernelSetup";

let k: Kernel;
beforeAll(async () => {
  k = await testKernel();
});

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const errors = (m: unknown) => validate(m, k).findings.filter((f) => f.level === "error");
const base = (): SpatialModel =>
  fromFloorPlan(plans()[0]?.plan as never, { program: plans()[0]?.program });

const quarter = Math.tan(Math.PI / 8);
const circle = (cx: number, cy: number, r: number, ccw = true): Vertex[] =>
  ccw
    ? [
        { x: cx + r, y: cy, bulge: quarter },
        { x: cx, y: cy + r, bulge: quarter },
        { x: cx - r, y: cy, bulge: quarter },
        { x: cx, y: cy - r, bulge: quarter },
      ]
    : [
        { x: cx + r, y: cy, bulge: -quarter },
        { x: cx, y: cy - r, bulge: -quarter },
        { x: cx - r, y: cy, bulge: -quarter },
        { x: cx, y: cy + r, bulge: -quarter },
      ];

describe("curves", () => {
  it("a circle of four arcs has the area of a circle", () => {
    const area = regionArea(toRegion({ outer: circle(0, 0, 3500), holes: [] }, 1));
    expect(Math.abs(area - Math.PI * 3500 ** 2) / (Math.PI * 3500 ** 2)).toBeLessThan(0.002);
  });

  it("a floor with a round conference room validates; its curved hole is subtracted", () => {
    const outer: Vertex[] = [
      { x: 0, y: 0 },
      { x: 20000, y: 0 },
      { x: 20000, y: 12000 },
      { x: 0, y: 12000 },
    ];
    const arc = (
      id: string,
      a: [number, number],
      b: [number, number],
      left: string,
      right: string,
    ) => ({
      id,
      levelId: "L0",
      a: { x: a[0], y: a[1] },
      b: { x: b[0], y: b[1] },
      bulge: 1,
      thicknessMm: 150,
      kind: "interior" as const,
      structural: "non_structural" as const,
      glazed: false,
      left,
      right,
      provenance: GENERATED,
    });
    const model: SpatialModel = {
      schema: "icarus.spatial/0.1",
      units: "mm",
      name: "round room",
      northDeg: 0,
      levels: [
        {
          id: "L0",
          name: "L0",
          elevationMm: 0,
          heightMm: 3000,
          boundary: { outer, holes: [] },
          provenance: GENERATED,
        },
      ],
      spaces: [
        {
          id: "conf",
          levelId: "L0",
          kind: "office.meeting_room",
          name: "Round",
          boundary: { outer: circle(10000, 6000, 3500), holes: [] },
          programme: {},
          locked: false,
          provenance: GENERATED,
        },
        {
          id: "floor",
          levelId: "L0",
          kind: "office.open_workspace",
          name: "Open",
          boundary: { outer, holes: [circle(10000, 6000, 3500, false)] },
          programme: {},
          locked: false,
          provenance: GENERATED,
        },
      ],
      walls: [
        arc("arc.1", [13500, 6000], [6500, 6000], "conf", "floor"),
        arc("arc.2", [6500, 6000], [13500, 6000], "conf", "floor"),
      ],
      openings: [
        {
          id: "d1",
          hostWallId: "arc.1",
          kind: "door",
          offsetMm: 2000,
          widthMm: 1000,
          sillMm: 0,
          headMm: 2100,
          entrance: true,
          provenance: GENERATED,
        },
      ],
      obstacles: [],
      connectors: [],
      items: [],
    };
    expect(errors(model)).toEqual([]);
    const floorArea = regionArea(toRegion(model.spaces[1]?.boundary as never, 1));
    expect(Math.abs(floorArea - (20000 * 12000 - Math.PI * 3500 ** 2)) / floorArea).toBeLessThan(
      0.002,
    );
  });
});

describe("an L-shaped level with columns", () => {
  const model = (): SpatialModel => {
    const outer: Vertex[] = [
      { x: 0, y: 0 },
      { x: 10000, y: 0 },
      { x: 10000, y: 4000 },
      { x: 4000, y: 4000 },
      { x: 4000, y: 8000 },
      { x: 0, y: 8000 },
    ];
    const rect = (x0: number, y0: number, x1: number, y1: number): Vertex[] => [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ];
    const sp = (id: string, ring: Vertex[]) => ({
      id,
      levelId: "L0",
      kind: "office.open_workspace",
      name: id,
      boundary: { outer: ring, holes: [] },
      programme: {},
      locked: false,
      provenance: GENERATED,
    });
    const wall = (
      id: string,
      a: [number, number],
      b: [number, number],
      left?: string,
      right?: string,
    ) => ({
      id,
      levelId: "L0",
      a: { x: a[0], y: a[1] },
      b: { x: b[0], y: b[1] },
      thicknessMm: 100,
      kind: "interior" as const,
      structural: "non_structural" as const,
      glazed: false,
      left,
      right,
      provenance: GENERATED,
    });
    return {
      schema: "icarus.spatial/0.1",
      units: "mm",
      name: "L",
      northDeg: 0,
      levels: [
        {
          id: "L0",
          name: "L0",
          elevationMm: 0,
          heightMm: 3000,
          boundary: { outer, holes: [] },
          provenance: GENERATED,
        },
      ],
      spaces: [sp("top", rect(0, 0, 10000, 4000)), sp("leg", rect(0, 4000, 4000, 8000))],
      walls: [
        wall("split", [0, 4000], [4000, 4000], "leg", "top"),
        {
          ...wall("wall.front", [0, 8000], [0, 4000], "leg", "exterior"),
          kind: "exterior" as const,
        },
      ],
      openings: [
        {
          id: "link",
          hostWallId: "split",
          kind: "passage",
          offsetMm: 1000,
          widthMm: 1500,
          sillMm: 0,
          headMm: 2100,
          entrance: false,
          provenance: GENERATED,
        },
        {
          id: "front",
          hostWallId: "wall.front",
          kind: "door",
          offsetMm: 1000,
          widthMm: 1500,
          sillMm: 0,
          headMm: 2100,
          entrance: true,
          provenance: GENERATED,
        },
      ],
      obstacles: [
        {
          id: "col",
          levelId: "L0",
          kind: "column",
          footprint: { outer: circle(2000, 2000, 250), holes: [] },
          provenance: GENERATED,
        },
      ],
      connectors: [],
      items: [],
    };
  };

  it("validates, is reachable, and its columns reduce usable area", () => {
    const m = model();
    expect(errors(m)).toEqual([]);
    expect(circulationGraph(m, k).unreachable).toEqual([]);
    const gross = regionArea(toRegion(m.spaces[0]?.boundary as never)) / 1e6;
    expect(gross).toBe(40);
    expect(usableAreaM2(m, "top", k)).toBeCloseTo(40 - Math.PI * 0.25 ** 2, 2);
  });

  it("a space that pokes into the missing corner is rejected", () => {
    const m = model();
    (m.spaces[0] as { boundary: { outer: Vertex[] } }).boundary.outer = [
      { x: 0, y: 0 },
      { x: 10000, y: 0 },
      { x: 10000, y: 8000 },
      { x: 0, y: 8000 },
    ];
    expect(errors(m).some((f) => f.code === "outside_level")).toBe(true);
  });
});

describe("validation rejects broken models", () => {
  it("overlaps, openings off the wall, bad winding, dangling ids, swapped sides, escapes, crossings", () => {
    const m = base();
    expect(errors(m)).toEqual([]);

    const overlap = clone(m);
    overlap.spaces[1]!.boundary = clone(overlap.spaces[0]!.boundary);
    expect(errors(overlap).some((f) => f.code === "spaces_overlap")).toBe(true);

    const past = clone(m);
    past.openings[0]!.offsetMm = 10_000_000;
    expect(errors(past).some((f) => f.code === "opening_outside_wall")).toBe(true);

    const wind = clone(m);
    wind.spaces[0]!.boundary.outer.reverse();
    expect(errors(wind).some((f) => f.code === "wrong_winding")).toBe(true);

    const dangling = clone(m);
    dangling.openings[0]!.hostWallId = "nope";
    expect(errors(dangling).some((f) => f.code === "missing_wall")).toBe(true);

    const swapped = clone(m);
    const w = swapped.walls.find(
      (x) =>
        x.left &&
        x.left !== "exterior" &&
        x.right &&
        x.right !== "exterior" &&
        x.kind !== "virtual",
    )!;
    [w.left, w.right] = [w.right, w.left];
    expect(errors(swapped).some((f) => f.code === "wrong_side")).toBe(true);

    const out = clone(m);
    out.spaces[0]!.boundary.outer = out.spaces[0]!.boundary.outer.map((v) => ({
      ...v,
      x: v.x + 90_000,
    }));
    expect(errors(out).some((f) => f.code === "outside_level")).toBe(true);

    const bow = clone(m);
    bow.spaces[0]!.boundary.outer = [
      { x: 0, y: 0 },
      { x: 4000, y: 3000 },
      { x: 4000, y: 0 },
      { x: 0, y: 3000 },
    ];
    expect(
      errors(bow).some((f) => f.code === "self_intersecting" || f.code === "wrong_winding"),
    ).toBe(true);

    const dup = clone(m);
    dup.spaces[1]!.id = dup.spaces[0]!.id;
    expect(errors(dup).some((f) => f.code === "duplicate_id")).toBe(true);

    const overlapOpen = clone(m);
    const host = overlapOpen.openings.find((o) => o.kind === "window")!;
    overlapOpen.openings.push({ ...host, id: "dup-window" });
    expect(errors(overlapOpen).some((f) => f.code === "openings_overlap")).toBe(true);
  });

  it("warns on a narrow door without failing the model", () => {
    const m = base();
    m.openings.find((o) => o.kind === "door" && !o.entrance)!.widthMm = 700;
    const f = validate(m, k).findings;
    expect(f.some((x) => x.code === "narrow_door" && x.level === "warn")).toBe(true);
    expect(f.filter((x) => x.level === "error")).toEqual([]);
  });
});

describe("circulation", () => {
  it("removing a door isolates a room; every other room stays reachable", () => {
    const m = base();
    const door = m.openings.find((o) => !o.entrance && o.kind === "door")!;
    m.openings = m.openings.filter((o) => o.id !== door.id);
    expect(circulationGraph(m, k).unreachable).toHaveLength(1);
  });

  it("two levels are joined only by a stair", () => {
    const a = base();
    const rename = (m: SpatialModel, s: string): SpatialModel => {
      const json = JSON.stringify(m).replace(
        /"(id|levelId|hostWallId|left|right|spaceId)":"(?!exterior)([^"]+)"/g,
        `"$1":"$2${s}"`,
      );
      return JSON.parse(json);
    };
    const up = rename(base(), ".up");
    up.openings = up.openings.filter((o) => !o.entrance);
    up.levels[0]!.elevationMm = 3200;
    const lobby = a.spaces.find((s) => s.kind === "circulation.lobby")!;
    const footprint = (levelId: string) => ({
      levelId,
      footprint: {
        outer: lobby.boundary.outer.map((v, i) => ({
          x: i === 1 || i === 2 ? lobby.boundary.outer[0]!.x + 1000 : v.x,
          y: v.y,
        })),
        holes: [],
      },
    });
    const both: SpatialModel = {
      ...a,
      levels: [...a.levels, ...up.levels],
      spaces: [...a.spaces, ...up.spaces],
      walls: [...a.walls, ...up.walls],
      openings: [...a.openings, ...up.openings],
      connectors: [
        {
          id: "stair",
          kind: "stair",
          serves: [footprint("L0"), footprint("L0.up")],
          provenance: GENERATED,
        },
      ],
    };
    expect(errors(both)).toEqual([]);
    expect(circulationGraph(both, k).unreachable).toEqual([]);
    const noStair = { ...both, connectors: [] };
    expect(circulationGraph(noStair, k).unreachable).toHaveLength(up.spaces.length);
  });
});

describe("uncertainty", () => {
  it("generated models may be shown as exact; guessed ones may not, and structure stays unknown", () => {
    expect(uncertaintySummary(base()).mayShowAsExact).toBe(true);
    const m = base();
    const w = m.walls.find((x) => x.kind === "exterior")!;
    w.provenance = { source: "inferred", evidence: [] };
    w.structural = "unknown";
    const u = uncertaintySummary(m);
    expect(u.mayShowAsExact).toBe(false);
    expect(u.unquantifiedIds).toContain(w.id);
    expect(u.wallMayBeMoved(w.id)).toBe(false);
    const part = m.walls.find((x) => x.kind === "interior")!;
    expect(u.wallMayBeMoved(part.id)).toBe(true);
    const measured = clone(m);
    measured.walls.find((x) => x.id === part.id)!.provenance = {
      source: "measured",
      toleranceMm: 30,
      confidence: 0.9,
      evidence: [],
    };
    expect(uncertaintySummary(measured).worstToleranceMm).toBe(30);
  });
});
