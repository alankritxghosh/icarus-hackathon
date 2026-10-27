import { describe, expect, it } from "vitest";
import { lockedSpaceIds, SAVED_VERSION, upgradeSaved } from "../src";
import { plans } from "./fixtures";

describe("saved office upgrade", () => {
  const { program, plan } = plans()[0] as ReturnType<typeof plans>[number];
  const kitchen = plan.rooms.find((r) => r.kind === "kitchen")?.id ?? "";
  const old = {
    id: "x",
    title: "Studio",
    program: { ...program, arrangement: plan.search.rows, locks: [{ id: kitchen, x: 3, y: 4 }] },
    plan,
  };

  it("adds a model whose locks are flags on spaces, and keeps the program as it was", () => {
    const up = upgradeSaved(old);
    expect(up.version).toBe(SAVED_VERSION);
    expect(lockedSpaceIds(up.model)).toEqual([kitchen]);
    expect(up.program).toEqual(old.program);
    expect(up.program.arrangement).toEqual(plan.search.rows);
    expect(up.title).toBe("Studio");
  });

  it("is idempotent and leaves an already upgraded save alone", () => {
    const once = upgradeSaved(old);
    const twice = upgradeSaved(once);
    expect(twice).toEqual(once);
    expect(twice.model).toBe(once.model);
  });

  it("the model does not depend on the row order", () => {
    const withRows = upgradeSaved(old).model;
    const without = upgradeSaved({
      ...old,
      program: { ...old.program, arrangement: undefined },
    }).model;
    expect(JSON.stringify(withRows.spaces.map((s) => s.boundary))).toBe(
      JSON.stringify(without.spaces.map((s) => s.boundary)),
    );
  });
});
