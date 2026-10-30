import { teach } from "@icarus/spatial/model";
import { describe, expect, it } from "vitest";
import { loadLessons, saveLessons } from "../src/accountLessons";

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
};

describe("lessons kept in this browser", () => {
  it("round-trips what was taught", () => {
    const store = memory();
    const { lessons } = teach([], "never put plants in the kitchen", new Date("2026-10-30"));
    saveLessons(lessons, store);
    expect(loadLessons(store)).toEqual(lessons);
  });

  it("starts empty when nothing, garbage or a broken store is there", () => {
    expect(loadLessons(memory())).toEqual([]);
    const bad = memory();
    bad.setItem("icarus.lessons.v1", "{not json");
    expect(loadLessons(bad)).toEqual([]);
    expect(
      loadLessons({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toEqual([]);
    expect(() =>
      saveLessons([], {
        setItem: () => {
          throw new Error("full");
        },
      }),
    ).not.toThrow();
  });

  it("drops stored lessons that are not valid rules instead of trusting them", () => {
    const store = memory();
    store.setItem(
      "icarus.lessons.v1",
      JSON.stringify({
        version: 1,
        lessons: [{ id: "A-1", said: "evil", rule: { type: "run-code", code: "x" }, date: "d" }],
      }),
    );
    expect(loadLessons(store)).toEqual([]);
  });
});
