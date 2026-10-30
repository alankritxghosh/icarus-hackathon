import { describe, expect, it } from "vitest";
import {
  auditAgainstDrawing,
  type DrawingEvidence,
  SCHEMA_VERSION,
  type SpatialModel,
} from "../src";

// A hand-made 6 m x 4 m house on a 200 mm wall grid, two rooms side by side, drawn by hand as the "sheet".
// Neither the model nor the evidence comes from the code under test, so the expected answers are known.
const rect = (x0: number, y0: number, x1: number, y1: number) => ({
  outer: [
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x1, y: y1 },
    { x: x0, y: y1 },
  ],
  holes: [],
});
const wall = (id: string, ax: number, ay: number, bx: number, by: number) => ({
  id,
  levelId: "L1",
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
  thicknessMm: 200,
  kind: "interior" as const,
  structural: "unknown" as const,
  glazed: false,
  provenance: { source: "generated" as const, evidence: [] },
});
const space = (
  id: string,
  name: string,
  kind: string,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
) => ({
  id,
  levelId: "L1",
  kind,
  name,
  boundary: rect(x0, y0, x1, y1),
  programme: {},
  locked: false,
  provenance: { source: "generated" as const, evidence: [] },
});
const item = (id: string, spaceId: string, kind: string) => ({
  id,
  spaceId,
  kind,
  at: { x: 1000, y: 1000 },
  sizeMm: { w: 800, d: 800, h: 800 },
  rotationDeg: 0,
  clearFrontMm: 0,
  provenance: { source: "generated" as const, evidence: [] },
});
const house = (): SpatialModel => ({
  schema: SCHEMA_VERSION,
  units: "mm",
  name: "hand-made",
  northDeg: 0,
  levels: [
    {
      id: "L1",
      name: "Ground",
      elevationMm: 0,
      heightMm: 3000,
      boundary: rect(0, 0, 6000, 4000),
      provenance: { source: "generated", evidence: [] },
    },
  ],
  spaces: [
    space("s_bed", "Bedroom", "residential.bedroom", 100, 100, 3000, 3900),
    space("s_gym", "Gym", "residential.gym", 3100, 100, 5900, 3900),
  ],
  walls: [
    wall("w_n", 0, 100, 6000, 100),
    wall("w_s", 0, 3900, 6000, 3900),
    wall("w_w", 100, 0, 100, 4000),
    wall("w_e", 5900, 0, 5900, 4000),
    wall("w_mid", 3050, 0, 3050, 4000),
  ],
  openings: [],
  obstacles: [],
  connectors: [],
  items: [item("bed1", "s_bed", "bed"), item("tread", "s_gym", "treadmill")],
});
const sheet = (): DrawingEvidence => ({
  schema: "icarus.drawing-evidence/0.1",
  source: "hand-drawn",
  wallRects: [
    [0, 0, 6000, 200],
    [0, 3800, 6000, 4000],
    [0, 0, 200, 4000],
    [5800, 0, 6000, 4000],
    [2950, 0, 3150, 4000],
  ],
  supportRects: [],
  labels: [
    { text: "BEDROOM", at: [1500, 2000], role: "room", printedSizeMm: [2900, 3800] },
    { text: "GYM", at: [4500, 2000], role: "room" },
  ],
});
const codes = (a: ReturnType<typeof auditAgainstDrawing>) => a.findings.map((f) => f.code).sort();

describe("auditAgainstDrawing", () => {
  it("passes a model that is the drawing", () => {
    const a = auditAgainstDrawing(house(), sheet());
    expect(a.ok, JSON.stringify(a.findings)).toBe(true);
    expect(a.checked).toEqual({ modelWalls: 5, drawnWalls: 5, roomLabels: 2 });
  });

  it("flags a wall the sheet does not draw", () => {
    const m = house();
    m.walls.push(wall("w_extra", 1000, 1800, 2800, 1800));
    const a = auditAgainstDrawing(m, sheet());
    expect(a.findings.filter((f) => f.code === "wall_not_in_drawing").map((f) => f.ids[0])).toEqual(
      ["w_extra"],
    );
  });

  it("flags a drawn wall the model left out", () => {
    const m = house();
    m.walls = m.walls.filter((w) => w.id !== "w_mid");
    expect(codes(auditAgainstDrawing(m, sheet()))).toContain("drawn_wall_missing");
  });

  it("lets a door leave a gap in a drawn wall", () => {
    const s = sheet();
    s.wallRects = [
      ...s.wallRects.filter((r) => r[0] !== 2950),
      [2950, 0, 3150, 1500],
      [2950, 2500, 3150, 4000],
    ];
    const m = house();
    m.openings.push({
      id: "d1",
      hostWallId: "w_mid",
      kind: "door",
      offsetMm: 1500,
      widthMm: 1000,
      sillMm: 0,
      headMm: 2100,
      entrance: false,
      provenance: { source: "generated", evidence: [] },
    });
    const a = auditAgainstDrawing(m, s);
    expect(a.ok, JSON.stringify(a.findings)).toBe(true);
  });

  it("flags a room that is renamed, moved out from under its label, or sized differently", () => {
    const renamed = house();
    (renamed.spaces[0] as { name: string }).name = "Study";
    expect(codes(auditAgainstDrawing(renamed, sheet()))).toContain("label_without_space");

    const moved = house();
    moved.spaces[1] = space("s_gym", "Gym", "residential.gym", 3100, 100, 4000, 1000);
    expect(codes(auditAgainstDrawing(moved, sheet()))).toContain("label_outside_space");

    const s = sheet();
    (s.labels[0] as { printedSizeMm?: [number, number] }).printedSizeMm = [4200, 3800];
    const a = auditAgainstDrawing(house(), s);
    expect(a.findings.find((f) => f.code === "size_mismatch")?.level).toBe("warn");
    expect(a.ok).toBe(true);
  });

  it("flags a bedroom with no bed and a gym with no equipment", () => {
    const m = house();
    m.items = [item("rug1", "s_gym", "rug")];
    const a = auditAgainstDrawing(m, sheet());
    expect(
      a.findings
        .filter((f) => f.code === "space_without_expected_item")
        .map((f) => f.ids[0])
        .sort(),
    ).toEqual(["s_bed", "s_gym"]);
  });

  it("does not call every room empty when the model places no items at all", () => {
    const m = house();
    m.items = [];
    const a = auditAgainstDrawing(m, sheet());
    expect(a.findings.filter((f) => f.code === "space_without_expected_item")).toEqual([]);
    expect(a.notAudited.join(" ")).toMatch(/no placed items/);
  });

  it("says what it cannot check", () => {
    expect(auditAgainstDrawing(house(), sheet()).notAudited.join(" ")).toMatch(
      /furniture orientation/,
    );
  });
});
