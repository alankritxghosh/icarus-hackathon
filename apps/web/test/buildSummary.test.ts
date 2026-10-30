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
        privateDesksWanted: 0,
        privateDesksPlaced: 0,
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

  it("includes private office desks in the total seating claim", () => {
    const built = {
      program: { rooms: [{ kind: "open_workspace" }, { kind: "private_office" }] },
      plan: { rooms: [{ kind: "open_workspace" }, { kind: "private_office" }] },
      report: {
        seatsWanted: 14,
        seatsPlaced: 14,
        privateDesksWanted: 6,
        privateDesksPlaced: 5,
        phoneBoothsWanted: 0,
        phoneBoothsPlaced: 0,
      },
    } as Built;
    expect(buildSummary(built)).toContain("19 of 20 workstations and 0 of 0 phone booths fit.");
    expect(buildSummary(built)).toContain("Still missing: 1 workstation.");
  });
});
