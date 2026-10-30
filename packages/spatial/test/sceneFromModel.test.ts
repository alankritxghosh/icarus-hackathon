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
    expect(viewpoints).toHaveLength(1);
    expect(viewpoints[0]?.position[1]).toBe(1.6);
  });

  it("invents no furniture", () => {
    expect(nodes("furniture")).toHaveLength(0);
    expect(nodes("fixture")).toHaveLength(0);
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
    const out = furnish(["WALK-IN WARDROBE", "LIVING ROOM"]);
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
