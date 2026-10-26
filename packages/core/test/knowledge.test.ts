import { describe, expect, it } from "vitest";
import {
  AREA_RULES,
  describeKnowledge,
  KIND_RULES,
  KNOWLEDGE,
  loadKnowledge,
  ROOM_KINDS,
} from "../src";
import { LOBBY_WIDTH_M } from "../src/layout/types";

describe("spatial knowledge as data", () => {
  it("covers every room kind, and every entry cites a listed source", () => {
    for (const kind of ROOM_KINDS) {
      const room = KNOWLEDGE.rooms[kind];
      expect(room.label, kind).toBeTruthy();
      expect(
        KNOWLEDGE.references.some((r) => r.id === room.source),
        kind,
      ).toBe(true);
      for (const wanted of room.adjacent) expect(ROOM_KINDS).toContain(wanted);
    }
  });

  it("derives exactly the rules the planner used when they were written in code", () => {
    expect(KIND_RULES.open_workspace).toMatchObject({
      minWidth: 6,
      minDepth: 5,
      daylight: "required",
      minScale: 0.8,
    });
    expect(KIND_RULES.restroom.adjacent).toEqual(["restroom"]);
    expect(AREA_RULES.open_workspace.area(35, 0)).toBe(210);
    expect(AREA_RULES.open_workspace.area(2, 0)).toBe(18);
    expect(AREA_RULES.meeting_room.area(35, 6)).toBe(15);
    expect(AREA_RULES.kitchen.area(35, 0)).toBeCloseTo(20.25, 6);
    expect(AREA_RULES.lounge.area(35, 0)).toBe(21);
    expect(AREA_RULES.restroom.area(35, 0)).toBeCloseTo(10.5, 6);
    expect(LOBBY_WIDTH_M).toBe(2);
  });

  it("says plainly that it is not a code check, and cites the ADA floors it follows", () => {
    expect(KNOWLEDGE.scope).toMatch(/not building-code/i);
    expect(KNOWLEDGE.circulation.minClearRouteM).toBeCloseTo(0.915, 3);
    expect(KNOWLEDGE.references.map((r) => r.text).join(" ")).toMatch(/403\.5\.1/);
  });

  it("describes itself for a model, with every kind and the stated limits", () => {
    const text = describeKnowledge();
    for (const kind of ROOM_KINDS) expect(text).toContain(kind);
    expect(text).toMatch(/not a building code/);
  });

  it("refuses a file that cites an unknown source or has inverted thresholds", () => {
    const clone = () => JSON.parse(JSON.stringify(KNOWLEDGE)) as typeof KNOWLEDGE;
    const unknown = clone();
    unknown.rooms.kitchen.source = "made-up";
    expect(() => loadKnowledge(unknown)).toThrow(/unknown source/);
    const inverted = clone();
    inverted.thresholds.workspacePerPersonWarnM2 = 9;
    expect(() => loadKnowledge(inverted)).toThrow(/warn threshold/);
    const missing = clone() as unknown as { rooms: Record<string, unknown> };
    missing.rooms.lounge = undefined;
    expect(() => loadKnowledge(missing)).toThrow();
  });
});
