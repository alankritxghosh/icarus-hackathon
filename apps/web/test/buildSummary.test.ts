import { describe, expect, it } from "vitest";
import { buildSummary } from "../src/buildSummary";
import type { Built } from "../src/design";

describe("buildSummary", () => {
  it("names what was built and reports furniture that did not fit", () => {
    const built = {
      program: {
        rooms: [{ kind: "open_workspace" }, { kind: "meeting_room" }, { kind: "kitchen" }],
      },
      plan: {
        rooms: [
          { kind: "open_workspace" },
          { kind: "meeting_room" },
          { kind: "meeting_room" },
          { kind: "kitchen" },
        ],
      },
      report: {
        seatsWanted: 12,
        seatsPlaced: 8,
        phoneBoothsWanted: 2,
        phoneBoothsPlaced: 1,
      },
    } as Built;
    expect(buildSummary(built)).toEqual([
      "Rooms: open workspace, 2 meeting rooms, kitchen.",
      "8 of 12 workstations and 1 of 2 phone booths fit.",
      "Still missing: 4 workstations and 1 phone booth.",
    ]);
  });
});
