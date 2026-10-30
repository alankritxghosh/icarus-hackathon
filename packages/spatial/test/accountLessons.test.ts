import { describe, expect, it } from "vitest";
import {
  type AccountLesson,
  checkLessons,
  fromFloorPlan,
  kindMatches,
  parseAccountLessons,
  ruleFromWords,
  type SpatialModel,
  teach,
} from "../src";
import { plans } from "./fixtures";

const base = (): SpatialModel =>
  fromFloorPlan(plans()[0]?.plan as never, { program: plans()[0]?.program });
const prov = { source: "generated" as const, evidence: [] };
const item = (id: string, spaceId: string, kind: string) => ({
  id,
  spaceId,
  kind,
  at: { x: 1000, y: 1000 },
  sizeMm: { w: 500, d: 500, h: 500 },
  rotationDeg: 0,
  clearFrontMm: 0,
  provenance: prov,
});
const kitchen = (m: SpatialModel) =>
  m.spaces.find((s) => s.kind.endsWith("kitchen")) as SpatialModel["spaces"][number];
const codes = (m: SpatialModel, lessons: AccountLesson[]) =>
  checkLessons(m, lessons).map((f) => f.code);

describe("understanding a sentence", () => {
  it("turns the phrasings it knows into rules, and nothing else", () => {
    expect(ruleFromWords("Never put plants in the kitchen.")).toEqual({
      type: "forbid-item",
      itemKind: "plant",
      inSpaceKind: "kitchen",
    });
    expect(ruleFromWords("no sofa in a meeting room")).toEqual({
      type: "forbid-item",
      itemKind: "sofa",
      inSpaceKind: "meeting_room",
    });
    expect(ruleFromWords("don't use plants")).toEqual({ type: "forbid-item", itemKind: "plant" });
    expect(ruleFromWords("always put a bin in every kitchen")).toEqual({
      type: "require-item",
      itemKind: "bin",
      inSpaceKind: "kitchen",
    });
    expect(ruleFromWords("no carpet in the kitchen")).toEqual({
      type: "forbid-floor",
      spaceKind: "kitchen",
      finish: "carpet",
    });
    expect(ruleFromWords("turn off L-gym-has-equipment")).toEqual({
      type: "disable-built-in",
      lesson: "L-gym-has-equipment",
    });
    expect(ruleFromWords("make it pop")).toBeUndefined();
    expect(ruleFromWords("")).toBeUndefined();
  });

  it("matches kinds by name or pattern", () => {
    expect(kindMatches("kitchen", "office.kitchen")).toBe(true);
    expect(kindMatches("kitchen", "office.kitchenette")).toBe(false);
    expect(kindMatches("office.*", "office.kitchen")).toBe(true);
    expect(kindMatches("residential.*", "office.kitchen")).toBe(false);
  });
});

describe("teaching an account", () => {
  it("keeps the person's words, numbers the lessons and refuses what it does not understand", () => {
    const a = teach([], "never put plants in the kitchen", new Date("2026-10-30"));
    expect(a.added).toMatchObject({
      id: "A-1",
      date: "2026-10-30",
      said: "never put plants in the kitchen",
    });
    const b = teach(a.lessons, "always put a bin in the kitchen");
    expect(b.added?.id).toBe("A-2");
    expect(teach(b.lessons, "make it pop").added).toBeUndefined();
    expect(teach(b.lessons, "make it pop").lessons).toHaveLength(2);
  });

  it("enforces the account's rules on a model, and only that account's", () => {
    const m = base();
    const k = kitchen(m);
    m.items.push(item("p1", k.id, "plant"));
    const lessons = teach([], "never put plants in the kitchen").lessons;
    expect(codes(m, lessons)).toEqual(["A-1"]);
    expect(codes(m, [])).toEqual([]);
    // Another room is fine.
    const other = base();
    const room = other.spaces.find(
      (s) => !s.kind.endsWith("kitchen"),
    ) as SpatialModel["spaces"][number];
    other.items.push(item("p2", room.id, "plant"));
    expect(codes(other, lessons)).toEqual([]);
  });

  it("requires an item, and forbids a floor finish", () => {
    const m = base();
    const k = kitchen(m);
    const req = teach([], "always put a bin in the kitchen").lessons;
    expect(codes(m, req)).toEqual(["A-1"]);
    m.items.push(item("b1", k.id, "bin"));
    expect(codes(m, req)).toEqual([]);
    (k as { floorFinish?: string }).floorFinish = "carpet";
    expect(codes(m, teach([], "no carpet in the kitchen").lessons)).toEqual(["A-1"]);
  });

  it("lets an account switch off a built-in lesson, but not a mandatory one", () => {
    const m = base();
    const room = m.spaces[0] as { kind: string };
    room.kind = "residential.living";
    m.items.push(item("pl", m.spaces[0]?.id as string, "plant"));
    expect(codes(m, [])).toContain("L-no-greenery-in-homes");
    const off = teach([], "turn off L-no-greenery-in-homes").lessons;
    expect(codes(m, off)).not.toContain("L-no-greenery-in-homes");
    const tryStairs = teach([], "turn off L-clear-stairs").lessons;
    expect(codes(m, tryStairs)).toContain("lesson_cannot_be_disabled");
  });
});

describe("stored lessons", () => {
  it("keeps the valid ones and counts the rest, whatever is in storage", () => {
    const good = teach([], "never put plants in the kitchen").lessons;
    const stored = {
      version: 1,
      lessons: [...good, { id: "x", said: "no", rule: { type: "nonsense" }, date: "d" }, 42],
    };
    expect(parseAccountLessons(stored)).toEqual({ lessons: good, dropped: 2 });
    expect(parseAccountLessons(null)).toEqual({ lessons: [], dropped: 0 });
    expect(parseAccountLessons("garbage").lessons).toEqual([]);
    expect(
      parseAccountLessons({ lessons: Array.from({ length: 60 }, () => good[0]) }).lessons,
    ).toHaveLength(50);
  });
});
