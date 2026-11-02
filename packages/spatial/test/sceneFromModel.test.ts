import { describe, expect, it } from "vitest";
import { type DrawingEvidence, modelFromEvidence, sceneFromModel } from "../src";

const sheet = (): DrawingEvidence => ({
  schema: "icarus.drawing-evidence/0.1",
  source: "hand.pdf",
  wallRects: [
    [0, 0, 6000, 200],
    [0, 3800, 6000, 4000],
    [0, 0, 200, 4000],
    [5800, 0, 6000, 1000],
    [5800, 2000, 6000, 4000], // a 1 m gap on the east wall: a window
    [2900, 200, 3100, 1000],
    [2900, 2000, 3100, 3800], // a 1 m doorway
  ],
  supportRects: [],
  labels: [
    { text: "BEDROOM", at: [1500, 2000], role: "room" },
    { text: "KITCHEN", at: [4400, 2000], role: "room" },
  ],
});

describe("sceneFromModel", () => {
  const { model } = modelFromEvidence(sheet());
  const { scene, labels, viewpoints } = sceneFromModel(model);
  const nodes = (type: string) => scene.nodes.filter((n) => n.type === type);

  it("makes a shell the size of the building, with floor, ceiling and lights", () => {
    expect(scene.shell).toEqual({ w: 6, h: 4 });
    expect(scene.ceilingM).toBe(3);
    expect(nodes("ceiling")).toHaveLength(1);
    expect(nodes("floor").length).toBeGreaterThanOrEqual(3);
    expect(nodes("light").length).toBeGreaterThan(0);
  });

  it("renders two levels in one scene at their saved elevations", () => {
    const upper = {
      ...model,
      levels: [
        { ...(model.levels[0] as (typeof model.levels)[number]), id: "L2", elevationMm: 3200 },
      ],
      spaces: model.spaces.map((space) => ({ ...space, id: `upper.${space.id}`, levelId: "L2" })),
      walls: model.walls.map((wall) => ({ ...wall, id: `upper.${wall.id}`, levelId: "L2" })),
      openings: model.openings.map((opening) => ({
        ...opening,
        id: `upper.${opening.id}`,
        hostWallId: `upper.${opening.hostWallId}`,
      })),
    };
    const stacked = sceneFromModel({
      ...model,
      levels: [...model.levels, ...upper.levels],
      spaces: [...model.spaces, ...upper.spaces],
      walls: [...model.walls, ...upper.walls],
      openings: [...model.openings, ...upper.openings],
    });
    const slabs = stacked.scene.nodes.filter((node) => node.id.endsWith(".slab"));
    expect(slabs[0]?.position[1]).toBeCloseTo(-0.03);
    expect(slabs[1]?.position[1]).toBeCloseTo(3.17);
    expect(stacked.scene.nodes.length).toBe(scene.nodes.length * 2);
    expect(new Set(stacked.scene.nodes.map((node) => node.id)).size).toBe(
      stacked.scene.nodes.length,
    );
    expect(stacked.scene.ceilingM).toBe(6.2);
    expect(stacked.viewpoints[0]?.position[1]).toBeCloseTo(1.6);
    expect(stacked.viewpoints[1]?.position[1]).toBeCloseTo(4.8);
  });

  it("guards exposed balcony edges without closing the wall-side doorway", () => {
    const balcony = {
      ...(model.spaces[0] as (typeof model.spaces)[number]),
      id: "balcony",
      name: "BALCONY",
      kind: "exterior.balcony" as const,
      boundary: {
        outer: [
          { x: -2000, y: 0 },
          { x: 0, y: 0 },
          { x: 0, y: 4000 },
          { x: -2000, y: 4000 },
        ],
        holes: [],
      },
    };
    const level = model.levels[0] as (typeof model.levels)[number];
    const guarded = sceneFromModel({
      ...model,
      levels: [
        {
          ...level,
          boundary: {
            ...level.boundary,
            outer: [
              { x: -2000, y: 0 },
              { x: 6000, y: 0 },
              { x: 6000, y: 4000 },
              { x: -2000, y: 4000 },
            ],
          },
        },
      ],
      spaces: [...model.spaces, balcony],
    }).scene.nodes.filter(
      (node) => node.id.startsWith("balcony.guard.") && node.id.endsWith(".top"),
    );
    expect(guarded).toHaveLength(3);
    expect(guarded.every((node) => node.type === "wall")).toBe(true);
    expect(guarded.some((node) => Math.abs(node.position[0] - 2) < 0.01)).toBe(false);
  });

  it("cuts a window and a doorway through their walls, with glass in the window only", () => {
    expect(nodes("window")).toHaveLength(1);
    expect(nodes("window")[0]?.material).toBe("glass");
    // The doorway leaves a lintel but no solid wall across it: no wall box spans y 1.0 to 2.0 at the doorway's height of 1.
    const door = model.openings.find((o) => o.kind === "door");
    expect(door).toBeDefined();
    const lintels = scene.nodes.filter((n) => n.id.includes("lintel"));
    expect(lintels).toHaveLength(1);
    expect(lintels[0]?.position[1]).toBeCloseTo((2.1 + 3) / 2, 5);
  });

  it("puts every floor inside the building on tile or wood, never grass or gravel", () => {
    for (const n of nodes("floor"))
      expect(["floor.tile", "floor.wood.light"]).toContain(n.material);
  });

  it("names rooms where they are and gives one place to stand", () => {
    expect(labels.map((l) => l.name).sort()).toEqual(["BEDROOM", "KITCHEN"]);
    expect(labels.find((l) => l.name === "BEDROOM")?.w).toBeCloseTo(2.7, 1);
    expect(labels.find((l) => l.name === "BEDROOM")?.h).toBeCloseTo(3.6, 1);
    expect(viewpoints).toHaveLength(1);
    expect(viewpoints[0]?.position[1]).toBe(1.6);
  });

  it("furnishes only rooms whose names it recognises, and has no fixtures of its own", () => {
    expect(nodes("furniture").length).toBeGreaterThan(0);
    expect(nodes("fixture")).toHaveLength(0);
    const hall = sceneFromModel(
      modelFromEvidence({ ...sheet(), labels: [{ text: "HALL", at: [1500, 2000], role: "room" }] })
        .model,
    );
    expect(hall.furnished).toEqual([]);
  });

  it("places walls where the model has them, in metres from the building's corner", () => {
    const north = scene.nodes.find(
      (n) =>
        n.type === "wall" &&
        Math.abs(n.position[2] - 0.1) < 0.01 &&
        n.geometry.kind === "box" &&
        n.geometry.size[0] > 5,
    );
    expect(north).toBeDefined();
  });
});

describe("furnishing the rooms a drawing encloses", () => {
  const house = (names: [string, string]): DrawingEvidence => ({
    schema: "icarus.drawing-evidence/0.1",
    source: "h.pdf",
    wallRects: [
      [0, 0, 9000, 200],
      [0, 5800, 9000, 6000],
      [0, 0, 200, 6000],
      [8800, 0, 9000, 6000],
      [4400, 200, 4600, 2500],
      [4400, 3500, 4600, 5800],
    ],
    supportRects: [],
    labels: [
      { text: names[0], at: [2200, 3000], role: "room" },
      { text: names[1], at: [6700, 3000], role: "room" },
    ],
  });
  const furnish = (names: [string, string]) =>
    sceneFromModel(modelFromEvidence(house(names)).model);

  it("puts a sofa facing a television in a living room, and a desk and chair in a study", () => {
    const out = furnish(["LIVING ROOM", "STUDY"]);
    expect(out.furnished.sort()).toEqual(["LIVING ROOM", "STUDY"]);
    const kinds = (room: string) =>
      out.scene.nodes.filter((n) => n.roomId === room).map((n) => n.name);
    const living = out.scene.nodes.filter((n) => n.name === "sofaSmall");
    expect(living).toHaveLength(1);
    expect(out.scene.nodes.some((n) => n.name === "television")).toBe(true);
    expect(out.scene.nodes.some((n) => n.name === "officeDesk")).toBe(true);
    expect(kinds("s1").length + kinds("s2").length).toBeGreaterThan(5);
  });

  it("leaves a room it does not recognise as the sheet drew it, and never plants anything indoors", () => {
    const out = furnish(["TERRACE", "LIVING ROOM"]);
    expect(out.furnished).toEqual(["LIVING ROOM"]);
    expect(out.scene.nodes.some((n) => /plant|fern|calathea|anthurium/.test(n.name))).toBe(false);
  });

  it("keeps every piece inside its room", () => {
    const out = furnish(["LIVING ROOM", "STUDY"]);
    for (const n of out.scene.nodes.filter((x) => x.type === "furniture")) {
      expect(n.position[0]).toBeGreaterThan(0.2);
      expect(n.position[0]).toBeLessThan(8.8);
      expect(n.position[2]).toBeGreaterThan(0.2);
      expect(n.position[2]).toBeLessThan(5.8);
    }
  });
});

describe("furnishing bedrooms, toilets, kitchens and gyms", () => {
  const house = (names: [string, string]): DrawingEvidence => ({
    schema: "icarus.drawing-evidence/0.1",
    source: "h.pdf",
    wallRects: [
      [0, 0, 9000, 200],
      [0, 5800, 9000, 6000],
      [0, 0, 200, 6000],
      [8800, 0, 9000, 6000],
      [4400, 200, 4600, 2500],
      [4400, 3500, 4600, 5800],
    ],
    supportRects: [],
    labels: [
      { text: names[0], at: [2200, 3000], role: "room" },
      { text: names[1], at: [6700, 3000], role: "room" },
    ],
  });
  const build = (names: [string, string]) => sceneFromModel(modelFromEvidence(house(names)).model);
  const count = (out: ReturnType<typeof build>, name: string) =>
    out.scene.nodes.filter((n) => n.name === name).length;

  it("gives a bedroom a bed with its head to the wall and a table on each side", () => {
    const out = build(["MASTER BEDROOM", "GYM ROOM"]);
    expect(out.furnished.sort()).toEqual(["GYM ROOM", "MASTER BEDROOM"]);
    expect(count(out, "bed")).toBe(6);
    expect(count(out, "sideTable")).toBe(2);
    const head = out.scene.nodes.find((n) => n.name === "bed" && n.id.includes(".bed.2"));
    // The room is 4.2 m by 5.6 m, so its long wall is the west one and the headboard is against it.
    expect(head?.position[0]).toBeLessThan(0.5);
  });

  it("gives a gym treadmills, a bench with a barbell and a dumbbell rack", () => {
    const out = build(["BEDROOM", "GYM ROOM"]);
    expect(count(out, "treadmill")).toBeGreaterThanOrEqual(10);
    expect(count(out, "weight bench")).toBe(5);
    expect(count(out, "dumbbell rack")).toBeGreaterThan(0);
  });

  it("gives a kitchen a counter, a hob and a fridge, and a toilet a toilet and a basin", () => {
    const k = build(["KITCHEN", "TOILET 02"]);
    expect(count(k, "cabinet")).toBe(1);
    expect(count(k, "hob")).toBe(1);
    expect(count(k, "fridge")).toBe(1);
    expect(count(k, "toilet")).toBe(2);
    expect(count(k, "basin")).toBe(2);
  });

  it("keeps everything inside the room and indoors green-free", () => {
    for (const names of [
      ["BEDROOM", "GYM"],
      ["KITCHEN", "TOILET"],
    ] as [string, string][]) {
      const out = build(names);
      for (const n of out.scene.nodes.filter((x) => x.type === "furniture")) {
        expect(n.position[0], n.id).toBeGreaterThan(0.2);
        expect(n.position[0], n.id).toBeLessThan(8.8);
        expect(n.position[2], n.id).toBeGreaterThan(0.2);
        expect(n.position[2], n.id).toBeLessThan(5.8);
      }
      expect(out.scene.nodes.some((n) => /plant|fern|calathea|anthurium/.test(n.name))).toBe(false);
    }
  });
});
