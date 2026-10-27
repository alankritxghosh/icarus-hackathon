import { describe, expect, it } from "vitest";
import { fromFloorPlan, toDxf } from "../src";
import { plans } from "./fixtures";

// A minimal independent reader: DXF is pairs of lines (group code, value).
function entities(dxf: string) {
  const lines = dxf.split("\n");
  const out: { type: string; fields: [number, string][] }[] = [];
  let inEntities = false;
  let cur: { type: string; fields: [number, string][] } | undefined;
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i]);
    const value = (lines[i + 1] ?? "").trim();
    if (code === 2 && value === "ENTITIES") inEntities = true;
    if (code === 0 && value === "ENDSEC") inEntities = false;
    if (!inEntities) continue;
    if (code === 0) {
      cur = { type: value, fields: [] };
      out.push(cur);
    } else cur?.fields.push([code, value]);
  }
  return out;
}

describe("toDxf", () => {
  const { plan, program } = plans()[0] as ReturnType<typeof plans>[number];
  const model = fromFloorPlan(plan, { program });
  const { dxf, skipped } = toDxf(model);
  const ents = entities(dxf);
  const count = (t: string, layer?: string) =>
    ents.filter(
      (e) => e.type === t && (!layer || e.fields.some(([c, v]) => c === 8 && v === layer)),
    ).length;

  it("is a well-formed DXF with the sections CAD programs expect", () => {
    expect(dxf.startsWith("0\nSECTION\n2\nHEADER")).toBe(true);
    expect(dxf.trimEnd().endsWith("0\nEOF")).toBe(true);
    for (const s of ["HEADER", "TABLES", "ENTITIES"]) expect(dxf).toContain(`2\n${s}\n`);
    expect(dxf.split("\n").length % 2).toBe(1); // pairs, plus the final newline
  });

  it("draws one outline per space, one label per space, a closed outline per physical wall", () => {
    const outlines = ents.filter(
      (e) => e.type === "POLYLINE" && e.fields.some(([c, v]) => c === 8 && v.startsWith("SPACE_")),
    );
    expect(outlines).toHaveLength(model.spaces.length);
    expect(count("TEXT", "LABELS")).toBe(model.spaces.length);
    expect(count("POLYLINE", "WALLS")).toBe(model.walls.filter((w) => w.kind !== "virtual").length);
    expect(count("POLYLINE")).toBe(outlines.length + count("POLYLINE", "WALLS"));
  });

  it("draws a line for every door and window", () => {
    expect(count("LINE", "DOORS")).toBe(model.openings.filter((o) => o.kind !== "window").length);
    expect(count("LINE", "WINDOWS")).toBe(model.openings.filter((o) => o.kind === "window").length);
    expect(skipped).toEqual([]);
  });

  it("puts the plan upright: a room in the north is drawn above one in the south", () => {
    const yOf = (name: string) => {
      const t = ents.find(
        (e) => e.type === "TEXT" && e.fields.some(([c, v]) => c === 1 && v === name),
      );
      return Number(t?.fields.find(([c]) => c === 20)?.[1]);
    };
    const centre = (id: string) => {
      const o = model.spaces.find((s) => s.id === id)?.boundary.outer ?? [];
      return o.reduce((a, v) => a + v.y, 0) / o.length;
    };
    const sorted = [...model.spaces].sort((p, q) => centre(p.id) - centre(q.id));
    const north = sorted[0];
    const south = sorted[sorted.length - 1];
    expect(centre(north?.id ?? "")).toBeLessThan(centre(south?.id ?? ""));
    expect(yOf(north?.name ?? "")).toBeGreaterThan(yOf(south?.name ?? ""));
  });

  it("keeps curves as bulges and mirrors their sign", () => {
    const circle = (r: number) =>
      [0, 1, 2, 3].map((i) => ({
        x: Math.round(r * Math.cos((i * Math.PI) / 2)),
        y: Math.round(r * Math.sin((i * Math.PI) / 2)),
        bulge: Math.tan(Math.PI / 8),
      }));
    const round = {
      ...model,
      spaces: [{ ...model.spaces[0]!, boundary: { outer: circle(1000), holes: [] } }],
      walls: [],
      openings: [],
      obstacles: [],
    };
    const bulges = entities(toDxf(round).dxf).flatMap((e) =>
      e.fields.filter(([c]) => c === 42).map(([, v]) => Number(v)),
    );
    expect(bulges).toHaveLength(4);
    for (const b of bulges) expect(b).toBeCloseTo(-Math.tan(Math.PI / 8), 6);
  });

  it("says what it leaves out", () => {
    const curved = {
      ...model,
      walls: model.walls.map((w, i) => (i === 0 ? { ...w, bulge: 0.5 } : w)),
    };
    const hosted = curved.openings.find((o) => o.hostWallId === curved.walls[0]?.id);
    expect(toDxf(curved).skipped.length).toBe(hosted ? 1 : 0);
  });
});
