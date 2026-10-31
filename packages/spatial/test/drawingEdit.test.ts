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

describe("moveDrawingWall", () => {
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
