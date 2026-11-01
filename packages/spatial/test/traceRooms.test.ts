import { describe, expect, it } from "vitest";
import {
  type DrawingEvidence,
  modelFromEvidence,
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
  it("replaces partial extraction and renders the reviewed spaces with CC0 furniture and finishes", () => {
    const base = modelFromEvidence(evidence).model;
    const levelId = base.levels[0]?.id as string;
    const reviewed = modelWithRoomTraces(base, [
      { id: "living", levelId, name: "LIVING ROOM", rect: [0, 0, 4000, 4000] },
      { id: "garden", levelId, name: "KITCHEN GARDEN", rect: [4000, 0, 6000, 4000] },
    ]);
    expect(reviewed.spaces.map((space) => space.name)).toEqual(["LIVING ROOM", "KITCHEN GARDEN"]);
    expect(reviewed.walls).toHaveLength(4);
    expect(reviewed.openings).toHaveLength(0);
    const { scene } = sceneFromModel(reviewed);
    expect(scene.nodes.some((node) => node.geometry.kind === "asset")).toBe(true);
    expect(scene.nodes.some((node) => node.material === "floor.landscape")).toBe(true);
    expect(scene.nodes.some((node) => node.material === "floor.wood.light")).toBe(true);
    expect(scene.nodes.some((node) => node.type === "light" || node.type === "ceiling")).toBe(
      false,
    );
  });
});
