import { describe, expect, it } from "vitest";
import { checkLessons, fromFloorPlan, LESSONS, type SpatialModel } from "../src";
import { plans } from "./fixtures";

const base = (): SpatialModel =>
  fromFloorPlan(plans()[0]?.plan as never, { program: plans()[0]?.program });
const prov = { source: "generated" as const, evidence: [] };
const thing = (
  id: string,
  spaceId: string,
  kind: string,
  x: number,
  y: number,
  rotationDeg = 0,
) => ({
  id,
  spaceId,
  kind,
  at: { x, y },
  sizeMm: { w: 800, d: 800, h: 800 },
  rotationDeg,
  clearFrontMm: 0,
  provenance: prov,
});
const residential = (m: SpatialModel): SpatialModel => {
  const s = m.spaces[0] as { kind: string };
  s.kind = "residential.living";
  return m;
};
const lessonsOf = (m: SpatialModel) => checkLessons(m).map((v) => v.code);

describe("lessons", () => {
  it("every lesson says what was said, the rule, the reason and where it is held", () => {
    for (const l of LESSONS) {
      expect(l.said.length, l.id).toBeGreaterThan(10);
      expect(l.rule.length, l.id).toBeGreaterThan(20);
      expect(l.why.length, l.id).toBeGreaterThan(10);
      expect(l.heldBy.length, l.id).toBeGreaterThan(5);
      if (l.enforcement === "check") expect(l.check, l.id).toBeTypeOf("function");
    }
  });

  it("a generated office breaks nothing that was taught", () => {
    expect(checkLessons(base())).toEqual([]);
  });

  it("rejects turf or gravel inside a building but allows it outdoors", () => {
    const m = base();
    (m.spaces[0] as { floorFinish?: string }).floorFinish = "turf";
    expect(lessonsOf(m)).toContain("L-indoor-floors-hard-or-soft");
    (m.spaces[0] as { kind: string }).kind = "exterior.garden";
    expect(lessonsOf(m)).not.toContain("L-indoor-floors-hard-or-soft");
    (m.spaces[0] as { floorFinish?: string }).floorFinish = "tile";
    expect(lessonsOf(m)).toEqual([]);
  });

  it("keeps plants out of houses but leaves them in offices", () => {
    const m = base();
    const room = m.spaces[0] as { id: string };
    m.items.push(thing("p1", room.id, "plant_tall", 1000, 1000));
    expect(lessonsOf(m)).toEqual([]);
    expect(lessonsOf(residential(m))).toContain("L-no-greenery-in-homes");
  });

  it("keeps things off a stair", () => {
    const m = base();
    const room = m.spaces[0] as { id: string; levelId: string };
    m.connectors.push({
      id: "st",
      kind: "stair",
      serves: [
        {
          levelId: room.levelId,
          footprint: {
            outer: [
              { x: 5000, y: 5000 },
              { x: 6000, y: 5000 },
              { x: 6000, y: 7000 },
              { x: 5000, y: 7000 },
            ],
            holes: [],
          },
        },
        {
          levelId: "other",
          footprint: {
            outer: [
              { x: 5000, y: 5000 },
              { x: 6000, y: 5000 },
              { x: 6000, y: 7000 },
              { x: 5000, y: 7000 },
            ],
            holes: [],
          },
        },
      ],
      provenance: prov,
    });
    m.items.push(thing("far", room.id, "plant_tall", 1000, 1000));
    expect(lessonsOf(m)).toEqual([]);
    m.items.push(thing("near", room.id, "plant_tall", 5500, 4800));
    expect(lessonsOf(m)).toEqual(["L-clear-stairs"]);
  });

  it("requires a television facing every sofa", () => {
    const m = base();
    const room = (m.spaces[0] as { id: string }).id;
    // Sofa at the origin facing +y (south); a TV 3 m south of it, turned 180 degrees to face back north.
    m.items.push(thing("sofa", room, "sofa", 4000, 2000, 0));
    expect(lessonsOf(m)).toContain("L-sofa-faces-a-television");
    m.items.push(thing("tv", room, "tv_unit", 4000, 5000, 180));
    expect(lessonsOf(m)).toEqual([]);
    // The same TV turned the wrong way, or off to the side, does not count.
    (m.items.find((i) => i.id === "tv") as { rotationDeg: number }).rotationDeg = 0;
    expect(lessonsOf(m)).toContain("L-sofa-faces-a-television");
    (m.items.find((i) => i.id === "tv") as { rotationDeg: number; at: { x: number } }).rotationDeg =
      180;
    (m.items.find((i) => i.id === "tv") as { at: { x: number } }).at.x = 7000;
    expect(lessonsOf(m)).toContain("L-sofa-faces-a-television");
  });
});
