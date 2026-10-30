import { beforeAll, describe, expect, it } from "vitest";
import {
  auditAgainstDrawing,
  type DrawingEvidence,
  type Kernel,
  modelFromEvidence,
  regionArea,
  toRegion,
  validate,
} from "../src";
import { testKernel } from "./kernelSetup";

let k: Kernel;
beforeAll(async () => {
  k = await testKernel();
});

// A hand-drawn 6 m x 4 m house: a west room, and two east rooms stacked, with a door between west and east-north.
const sheet = (): DrawingEvidence => ({
  schema: "icarus.drawing-evidence/0.1",
  source: "hand.pdf",
  wallRects: [
    [0, 0, 6000, 200],
    [0, 3800, 6000, 4000],
    [0, 0, 200, 4000],
    [5800, 0, 6000, 4000],
    [2900, 200, 3100, 1000],
    [2900, 2000, 3100, 3800], // a 1 m doorway between y 1000 and 2000
    [3100, 1900, 5800, 2100],
  ],
  supportRects: [],
  labels: [
    { text: "BEDROOM", at: [1500, 2000], role: "room" },
    { text: "KITCHEN", at: [4400, 1000], role: "room" },
    { text: "GYM", at: [4400, 3000], role: "room" },
    { text: "BALCONY", at: [7000, 2000], role: "room" },
  ],
});

describe("modelFromEvidence", () => {
  it("makes walls, a door and the rooms the walls enclose, and leaves out the one they do not", () => {
    const { model, report } = modelFromEvidence(sheet());
    expect(report.walls).toBe(6);
    expect(model.openings.map((o) => [o.kind, o.widthMm])).toEqual([["door", 1000]]);
    expect(model.spaces.map((s) => s.name).sort()).toEqual(["BEDROOM", "GYM", "KITCHEN"]);
    expect(report.unplaced).toEqual(["BALCONY"]);
    expect(model.spaces.find((s) => s.name === "GYM")?.kind).toBe("residential.gym");
    expect(model.spaces.every((s) => s.provenance.source === "measured")).toBe(true);
  });

  it("gives each room close to the floor between its walls, including the part a doorway narrows", () => {
    const { model } = modelFromEvidence(sheet());
    const area = (name: string) =>
      regionArea(toRegion(model.spaces.find((s) => s.name === name)?.boundary as never)) / 1e6;
    // Between wall faces: bedroom 2.7 x 3.6, kitchen and gym 2.7 x 1.7 and 2.7 x 1.7.
    expect(area("BEDROOM")).toBeCloseTo(2.7 * 3.6, 0);
    expect(area("KITCHEN")).toBeCloseTo(2.7 * 1.7, 0);
    expect(area("GYM")).toBeCloseTo(2.7 * 1.7, 0);
  });

  it("is a valid spatial model: nothing overlaps, every opening sits on its wall", () => {
    const { model } = modelFromEvidence(sheet());
    const { findings } = validate(model, k);
    expect(
      findings.filter((f) => f.level === "error"),
      JSON.stringify(findings),
    ).toEqual([]);
  });

  it("agrees with the sheet it came from, and an edit that adds a wall is caught", () => {
    const { model } = modelFromEvidence(sheet());
    // The audit rightly still reports the label the model could not place.
    expect(auditAgainstDrawing(model, sheet()).findings.map((f) => f.code)).toEqual([
      "label_without_space",
    ]);
    const withoutBalcony = { ...sheet(), labels: sheet().labels.slice(0, 3) };
    expect(
      auditAgainstDrawing(model, withoutBalcony).findings.filter((f) => f.level === "error"),
    ).toEqual([]);
    model.walls.push({
      id: "extra",
      levelId: "L1",
      a: { x: 600, y: 1800 },
      b: { x: 2600, y: 1800 },
      thicknessMm: 200,
      kind: "interior",
      structural: "unknown",
      glazed: false,
      provenance: { source: "generated", evidence: [] },
    });
    expect(auditAgainstDrawing(model, sheet()).findings.map((f) => f.code)).toContain(
      "wall_not_in_drawing",
    );
  });

  it("refuses a drawing with no walls", () => {
    expect(() => modelFromEvidence({ ...sheet(), wallRects: [] })).toThrow(/no walls/);
  });
});
