import { describe, expect, it } from "vitest";
import {
  type DrawingEvidence,
  modelFromEvidence,
  modelWithReviewedOpenings,
  modelWithRoomTraces,
  sceneFromModel,
} from "../src";

const evidence: DrawingEvidence = {
  schema: "icarus.drawing-evidence/0.1",
  source: "plan.pdf",
  wallRects: [
    [0, 0, 6000, 150],
    [0, 3850, 6000, 4000],
    [0, 0, 150, 4000],
    [5850, 0, 6000, 4000],
  ],
  supportRects: [],
  labels: [{ text: "ORIGINAL", at: [3000, 2000], role: "room" }],
};

describe("reviewed room outlines", () => {
  it("does not furnish a bedroom foyer as another bedroom", () => {
    const base = modelFromEvidence(evidence).model;
    const levelId = base.levels[0]?.id as string;
    const reviewed = modelWithRoomTraces(base, [
      { id: "foyer", levelId, name: "MASTER BEDROOM FOYER", rect: [0, 0, 4000, 3000] },
      { id: "bedroom", levelId, name: "MASTER BEDROOM", rect: [0, 3000, 4000, 7000] },
    ]);
    expect(reviewed.spaces.map((space) => space.kind)).toEqual([
      "residential.living",
      "residential.bedroom",
    ]);
    const beds = sceneFromModel(reviewed).scene.nodes.filter((node) => node.name === "bed");
    expect(beds).toHaveLength(6);
    expect(beds.every((node) => node.roomId === `trace.${levelId}.bedroom`)).toBe(true);
  });

  it("replaces partial extraction and renders the reviewed spaces with CC0 furniture and finishes", () => {
    const base = modelFromEvidence(evidence).model;
    const levelId = base.levels[0]?.id as string;
    const reviewed = modelWithRoomTraces(base, [
      { id: "living", levelId, name: "LIVING ROOM", rect: [0, 0, 4000, 4000] },
      { id: "garden", levelId, name: "KITCHEN GARDEN", rect: [4000, 0, 6000, 4000] },
    ]);
    expect(reviewed.spaces.map((space) => space.name)).toEqual(["LIVING ROOM", "KITCHEN GARDEN"]);
    expect(reviewed.walls).toHaveLength(4);
    expect(reviewed.openings).toHaveLength(1);
    const { scene } = sceneFromModel(reviewed);
    expect(scene.nodes.some((node) => node.geometry.kind === "asset")).toBe(true);
    expect(scene.nodes.some((node) => node.material === "floor.landscape")).toBe(true);
    expect(scene.nodes.some((node) => node.material === "floor.wood.light")).toBe(true);
    expect(scene.nodes.some((node) => node.type === "light")).toBe(false);
    expect(scene.nodes.some((node) => node.tags.includes("roof"))).toBe(true);
  });

  it("cuts an estimated entrance between a foyer and its lobby", () => {
    const base = modelFromEvidence(evidence).model;
    const levelId = base.levels[0]?.id as string;
    const reviewed = modelWithRoomTraces(base, [
      { id: "foyer", levelId, name: "FOYER", rect: [0, 0, 3000, 3000] },
      { id: "lobby", levelId, name: "LOBBY", rect: [1000, 3000, 4000, 5000] },
    ]);
    expect(reviewed.openings).toHaveLength(1);
    expect(reviewed.openings[0]?.entrance).toBe(true);
    const drawn = sceneFromModel(reviewed);
    const view = drawn.viewpoints[0];
    expect(view?.name).toBe("East entrance");
    expect(view?.position[2]).toBeGreaterThan(view?.target[2] ?? 0);
    const walls = drawn.scene.nodes.filter(
      (node) => node.type === "wall" && node.geometry.kind === "box",
    );
    for (let step = 0; step <= 20; step++) {
      const t = step / 20;
      const x = (view?.position[0] ?? 0) * (1 - t) + (view?.target[0] ?? 0) * t;
      const z = (view?.position[2] ?? 0) * (1 - t) + (view?.target[2] ?? 0) * t;
      expect(
        walls.some((node) => {
          if (node.geometry.kind !== "box" || node.position[1] - node.geometry.size[1] / 2 > 1.65)
            return false;
          const [width, , depth] = node.geometry.size;
          const sideways = Math.abs(Math.sin(node.rotationY)) > 0.5;
          return (
            Math.abs(x - node.position[0]) < (sideways ? depth : width) / 2 + 0.2 &&
            Math.abs(z - node.position[2]) < (sideways ? width : depth) / 2 + 0.2
          );
        }),
      ).toBe(false);
    }
  });

  it("replaces an adjacency guess with the source-located opening in the model and scene", () => {
    const base = modelFromEvidence(evidence).model;
    const levelId = base.levels[0]?.id as string;
    const traced = modelWithRoomTraces(base, [
      { id: "foyer", levelId, name: "FOYER", rect: [0, 0, 4000, 3000] },
      { id: "lobby", levelId, name: "LOBBY", rect: [0, 3000, 4000, 5000] },
    ]);
    const guess = traced.openings.find((opening) => opening.hostWallId.endsWith("foyer.w2"));
    expect(guess).toBeDefined();
    const reviewed = modelWithReviewedOpenings(traced, [
      {
        ...guess!,
        id: "sheet-door",
        offsetMm: 200,
        widthMm: 800,
        provenance: { source: "measured", toleranceMm: 100, evidence: ["sheet:foyer-south-door"] },
      },
    ]);
    expect(
      reviewed.openings.filter((opening) => opening.hostWallId === guess!.hostWallId),
    ).toHaveLength(1);
    expect(
      reviewed.openings.find((opening) => opening.id === "sheet-door")?.provenance.evidence,
    ).toEqual(["sheet:foyer-south-door"]);
    const walls = sceneFromModel(reviewed).scene.nodes.filter(
      (node) =>
        node.id.startsWith(guess!.hostWallId) &&
        node.type === "wall" &&
        !node.id.includes("lintel"),
    );
    // The wall runs from x=4000 to x=0. The reviewed 800 mm gap is near its right end.
    const blocks = (x: number) =>
      walls.some(
        (node) =>
          node.geometry.kind === "box" &&
          Math.abs(node.position[0] - x) < node.geometry.size[0] / 2,
      );
    expect(blocks(3.4)).toBe(false);
    expect(blocks(2)).toBe(true);
    const sourceOnly = modelWithReviewedOpenings(
      traced,
      reviewed.openings.filter((opening) => opening.id === "sheet-door"),
      true,
    );
    expect(sourceOnly.openings.map((opening) => opening.id)).toEqual(["sheet-door"]);
    expect(modelWithReviewedOpenings(traced, [], true).openings).toEqual([]);
    expect(() => modelWithReviewedOpenings(traced, [{ ...guess!, id: "unsupported" }])).toThrow(
      "needs a source reference",
    );
  });
});
