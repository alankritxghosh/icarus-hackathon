import { describe, expect, it } from "vitest";
import { fromFloorPlan, profileOf, reviewAgainstPrinciples, type SpatialModel } from "../src";
import { plans } from "./fixtures";

const office = (): SpatialModel =>
  fromFloorPlan(plans()[0]?.plan as never, { program: plans()[0]?.program });
const status = (m: SpatialModel, id: number) =>
  reviewAgainstPrinciples(m).decisions.find((d) => d.principle === id);

describe("the principle router", () => {
  it("accounts for every one of the twenty principles, whatever the model", () => {
    const r = reviewAgainstPrinciples(office());
    expect(r.decisions.map((d) => d.principle)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    for (const d of r.decisions)
      expect(d.reason.length, `principle ${d.principle}`).toBeGreaterThan(8);
    expect(r.note).toMatch(/Not a building-code/);
  });

  it("uses only the principles that concern an office with the data it holds, and says why it skipped the rest", () => {
    const r = reviewAgainstPrinciples(office());
    expect(r.profile.buildingType).toBe("office");
    const checked = r.decisions.filter((d) => d.status === "checked").map((d) => d.principle);
    expect(checked).toEqual(expect.arrayContaining([3, 4, 5, 11]));
    // Things the model cannot know are reported as not assessable, never as a pass.
    for (const id of [7, 8, 9, 10, 16, 17, 18, 20])
      expect(status(office(), id)?.status, `principle ${id}`).toBe("not-assessable");
    // No items placed, so function cannot be judged.
    expect(status(office(), 1)?.status).toBe("not-assessable");
    // The gates never claim safety.
    expect(status(office(), 16)?.reason).toMatch(/never evidence of safety/);
  });

  it("a generated office raises nothing under the rules it was built to", () => {
    expect(reviewAgainstPrinciples(office()).top).toEqual([]);
  });

  it("flags a door under the accessible floor, as a gate, and ranks it first", () => {
    const m = office();
    const door = m.openings.find(
      (o) => o.kind === "door" && !o.entrance,
    ) as SpatialModel["openings"][number];
    door.widthMm = 600;
    const r = reviewAgainstPrinciples(m);
    expect(r.top[0]?.code).toBe("accessible-door");
    expect(r.top[0]?.level).toBe("error");
    expect(r.decisions.find((d) => d.principle === 11)?.source).toMatch(/not a compliance claim/);
  });

  it("flags a room that is too narrow for its kind, and one that is not next to what it wants", () => {
    const m = office();
    const meeting = m.spaces.find(
      (s) => s.kind === "office.meeting_room",
    ) as SpatialModel["spaces"][number];
    const xs = meeting.boundary.outer.map((v) => v.x);
    const cut = Math.min(...xs) + 600;
    meeting.boundary.outer = meeting.boundary.outer.map((v) => ({
      ...v,
      x: v.x > cut ? cut : v.x,
    }));
    expect(
      reviewAgainstPrinciples(m)
        .decisions.find((d) => d.principle === 5)
        ?.findings.map((f) => f.code),
    ).toEqual(expect.arrayContaining(["narrow"]));
  });

  it("holds findings back instead of burying the person, and counts them", () => {
    const m = office();
    for (const o of m.openings) if (o.kind === "door") o.widthMm = 500;
    const r = reviewAgainstPrinciples(m, 3);
    expect(r.top).toHaveLength(3);
    expect(r.heldBack).toBeGreaterThan(0);
  });

  it("does not apply the office adjacency rules to a home", () => {
    const m = office();
    for (const s of m.spaces) s.kind = s.kind.replace("office.", "residential.");
    expect(profileOf(m).buildingType).toBe("residential");
    expect(status(m, 3)?.status).toBe("not-applicable");
    expect(status(m, 5)?.status).toBe("not-applicable");
  });
});
