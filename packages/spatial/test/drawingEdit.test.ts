import { beforeAll, describe, expect, it } from "vitest";
import {
  type DrawingEvidence,
  type Kernel,
  modelFromEvidence,
  moveDrawingWall,
  sceneFromModel,
  validate,
} from "../src";
import { testKernel } from "./kernelSetup";

let kernel: Kernel;
beforeAll(async () => {
  kernel = await testKernel();
});

const sheet = (): DrawingEvidence => ({
  schema: "icarus.drawing-evidence/0.1",
  source: "measured-demo.pdf",
  wallRects: [
    [0, 0, 6000, 200],
    [0, 3800, 6000, 4000],
    [0, 0, 200, 4000],
    [5800, 0, 6000, 4000],
    [2900, 200, 3100, 1000],
    [2900, 2000, 3100, 3800],
  ],
  supportRects: [],
  labels: [
    { text: "KITCHEN", at: [1500, 2000], role: "room" },
    { text: "OFFICE", at: [4500, 2000], role: "room" },
  ],
});

const threeRoomSheet = (): DrawingEvidence => ({
  schema: "icarus.drawing-evidence/0.1",
  source: "three-room-demo.pdf",
  wallRects: [
    [0, 0, 8000, 200],
    [0, 3800, 8000, 4000],
    [0, 0, 200, 4000],
    [7800, 0, 8000, 4000],
    [2500, 200, 2700, 1000],
    [2500, 2000, 2700, 3800],
    [5200, 200, 5400, 1000],
    [5200, 2000, 5400, 3800],
  ],
  supportRects: [],
  labels: [
    { text: "KITCHEN", at: [1300, 2000], role: "room" },
    { text: "OFFICE", at: [3950, 2000], role: "room" },
    { text: "MEETING", at: [6600, 2000], role: "room" },
  ],
});

describe("moveDrawingWall", () => {
  it("moves two distinct partitions in sequence without altering the outer shell or the third room", () => {
    const evidence = threeRoomSheet();
    const before = modelFromEvidence(evidence).model;
    expect(before.spaces.map((s) => s.name).sort()).toEqual(["KITCHEN", "MEETING", "OFFICE"]);
    const first = moveDrawingWall(
      before,
      evidence,
      "move the wall between kitchen and office 0.3 m toward office",
    );
    expect("moved" in first, "reason" in first ? first.reason : "").toBe(true);
    if (!("moved" in first)) return;
    const roomBoundary = (model: typeof before, name: string) =>
      model.spaces.find((space) => space.name === name)?.boundary;
    expect(roomBoundary(first.moved.model, "MEETING")).toEqual(roomBoundary(before, "MEETING"));
    const second = moveDrawingWall(
      first.moved.model,
      first.moved.evidence,
      "move the wall between office and meeting 0.3 m toward meeting",
    );
    expect("moved" in second, "reason" in second ? second.reason : "").toBe(true);
    if (!("moved" in second)) return;
    expect(roomBoundary(second.moved.model, "KITCHEN")).toEqual(
      roomBoundary(first.moved.model, "KITCHEN"),
    );
    expect(second.moved.evidence.wallRects[4]).toEqual([2800, 200, 3000, 1000]);
    expect(second.moved.evidence.wallRects[6]).toEqual([5500, 200, 5700, 1000]);
    expect(second.moved.evidence.wallRects.slice(0, 4)).toEqual(evidence.wallRects.slice(0, 4));
    expect(second.moved.model.openings).toHaveLength(before.openings.length);
    expect(second.moved.model.spaces.map((s) => s.name).sort()).toEqual([
      "KITCHEN",
      "MEETING",
      "OFFICE",
    ]);
    expect(
      validate(second.moved.model, kernel).findings.filter((f) => f.level === "error"),
    ).toEqual([]);
  });
  it("moves one partition and its door exactly 500 mm; both floors update and the shell stays", () => {
    const evidence = sheet();
    const before = modelFromEvidence(evidence).model;
    const result = moveDrawingWall(
      before,
      evidence,
      "move the wall between kitchen and office 0.5 m toward office",
    );
    expect("moved" in result, "reason" in result ? result.reason : "").toBe(true);
    if (!("moved" in result)) return;
    const after = result.moved.model;
    expect(result.moved.message).toMatch(/Furniture no longer fits in OFFICE/);
    expect(evidence.wallRects).toEqual(sheet().wallRects); // original evidence is untouched
    expect(after.walls.find((w) => w.id === "w5")?.a.x).toBe(3500);
    expect(after.openings).toEqual(
      expect.arrayContaining([expect.objectContaining({ hostWallId: "w5", widthMm: 1000 })]),
    );
    expect(after.levels).toEqual(before.levels);
    expect(after.spaces.map((s) => s.name).sort()).toEqual(["KITCHEN", "OFFICE"]);
    const rendered = sceneFromModel(after);
    expect(rendered.labels.find((l) => l.name === "KITCHEN")?.w).toBeGreaterThan(
      sceneFromModel(before).labels.find((l) => l.name === "KITCHEN")?.w ?? 0,
    );
    expect(validate(after, kernel).findings.filter((f) => f.level === "error")).toEqual([]);
  });

  it("refuses a move that would consume the named room without changing the input", () => {
    const evidence = sheet();
    const before = modelFromEvidence(evidence).model;
    const snapshot = JSON.stringify({ before, evidence });
    const result = moveDrawingWall(
      before,
      evidence,
      "move the wall between kitchen and office 2 m toward office",
    );
    expect("reason" in result).toBe(true);
    expect(JSON.stringify({ before, evidence })).toBe(snapshot);
  });

  it("refuses an unsupported edit instead of pretending it happened", () => {
    const evidence = sheet();
    expect(
      "reason" in
        moveDrawingWall(modelFromEvidence(evidence).model, evidence, "move the kitchen east"),
    ).toBe(true);
  });
});
