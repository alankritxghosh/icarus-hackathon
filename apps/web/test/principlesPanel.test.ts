import { ProgramSchema } from "@icarus/core";
import { reviewAgainstPrinciples } from "@icarus/spatial/model";
import { describe, expect, it } from "vitest";
import { rebuild } from "../src/design";

describe("the principles for a built office", () => {
  it("reviews the model the app already holds, accounting for all twenty", () => {
    const program = ProgramSchema.parse({
      company: { headcount: 8 },
      shell: { widthM: 12, depthM: 9, windows: ["north"], entrance: "south" },
      rooms: [
        { kind: "open_workspace" },
        { kind: "meeting_room", capacity: 4 },
        { kind: "restroom" },
        { kind: "reception" },
      ],
    });
    const built = rebuild(program, 1, []);
    const review = reviewAgainstPrinciples(built.model);
    expect(review.decisions).toHaveLength(20);
    expect(review.profile.buildingType).toBe("office");
    expect(review.decisions.filter((d) => d.status === "checked").length).toBeGreaterThanOrEqual(4);
  });
});
