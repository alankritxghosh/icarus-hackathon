import { describe, expect, it } from "vitest";
import {
  mergeProposal,
  type Proposal,
  ProposalSchema,
  proposeInput,
  proposeInstructions,
  readBrief,
  reviseInput,
  reviseInstructions,
} from "../src";

const STATED =
  "A 35-person design studio with three meeting rooms and two phone booths, a kitchen, reception. 24 m by 16 m shell, windows on south and east walls, entrance on the west.";
const OPEN = "A 20-person design studio. Windows on the south wall, entrance on the west.";

const proposal = (over: Partial<Proposal> = {}): Proposal => ProposalSchema.parse({ ...over });

describe("ProposalSchema", () => {
  it("accepts a small proposal and refuses nonsense or out-of-range values", () => {
    expect(ProposalSchema.safeParse({}).success).toBe(true);
    expect(ProposalSchema.safeParse({ meetingRooms: 40 }).success).toBe(false);
    expect(ProposalSchema.safeParse({ addRooms: ["swimming_pool"] }).success).toBe(false);
    expect(ProposalSchema.safeParse({ preferences: { areaScale: { kitchen: 9 } } }).success).toBe(
      false,
    );
    expect(
      ProposalSchema.safeParse({
        decisions: Array(9).fill({ topic: "a", choice: "b", reason: "c" }),
      }).success,
    ).toBe(false);
  });
});

describe("mergeProposal", () => {
  it("never overrides what the brief stated, and says so", () => {
    const read = readBrief(STATED);
    const merged = mergeProposal(read, proposal({ meetingRooms: 6, phoneBooths: 9 }));
    expect(merged.program.rooms.find((r) => r.kind === "meeting_room")?.count).toBe(3);
    expect(merged.program.phoneBooths).toBe(2);
    expect(merged.ignored.join(" ")).toMatch(/states the number of meeting rooms/);
    expect(merged.ignored.join(" ")).toMatch(/phone booths/);
    expect(merged.program.shell).toEqual(read.program.shell);
    expect(merged.program.company).toEqual(read.program.company);
  });

  it("fills what the brief left open, adds restrained extras, and records decisions as model assumptions", () => {
    const read = readBrief(OPEN);
    const merged = mergeProposal(
      read,
      proposal({
        meetingRooms: 3,
        phoneBooths: 2,
        addRooms: ["lounge", "server_room"],
        decisions: [
          {
            topic: "meeting rooms",
            choice: "three",
            reason: "a design studio reviews work in small groups",
          },
        ],
      }),
    );
    expect(merged.program.rooms.find((r) => r.kind === "meeting_room")?.count).toBe(3);
    expect(merged.program.phoneBooths).toBe(2);
    expect(merged.program.rooms.map((r) => r.kind)).toEqual(
      expect.arrayContaining(["lounge", "server_room"]),
    );
    const noted = merged.program.assumptions.filter((a) => a.source === "model");
    expect(noted).toHaveLength(1);
    expect(noted[0]?.statement).toMatch(/small groups/);
  });

  it("does not add a room kind that is already present", () => {
    const read = readBrief(STATED);
    const before = read.program.rooms.filter((r) => r.kind === "kitchen").length;
    const merged = mergeProposal(read, proposal({ addRooms: ["kitchen"] }));
    expect(merged.program.rooms.filter((r) => r.kind === "kitchen")).toHaveLength(before);
  });

  it("drops wishes about rooms the office does not have", () => {
    const read = readBrief(OPEN);
    const merged = mergeProposal(
      read,
      proposal({
        preferences: {
          adjacent: [
            { a: "kitchen", b: "private_office", weight: 1 },
            { a: "kitchen", b: "reception", weight: 2 },
          ],
          apart: [],
          areaScale: { private_office: 1.3, kitchen: 1.2 },
        },
      }),
    );
    expect(merged.program.preferences.adjacent).toEqual([
      { a: "kitchen", b: "reception", weight: 2 },
    ]);
    expect(merged.program.preferences.areaScale).toEqual({ kitchen: 1.2 });
    expect(merged.ignored.join(" ")).toMatch(/does not have/);
  });

  it("always returns a program that can be planned", () => {
    for (const text of [STATED, OPEN]) {
      const merged = mergeProposal(
        readBrief(text),
        proposal({ meetingRooms: 0, restrooms: 4, addRooms: ["private_office", "storage"] }),
      );
      expect(merged.program.rooms.some((r) => r.kind === "open_workspace")).toBe(true);
      expect(merged.program.rooms.every((r) => r.count >= 1)).toBe(true);
    }
  });
});

describe("prompts", () => {
  it("are built from the knowledge file, and ground the model in the stated facts", () => {
    const read = readBrief(OPEN);
    expect(proposeInstructions()).toContain("0.6 m2 per person");
    expect(proposeInstructions()).toMatch(/do NOT give coordinates/);
    const input = proposeInput(OPEN, read);
    expect(input).toContain("headcount 20");
    expect(input).toMatch(/assumed \(not stated\):/);
    expect(reviseInstructions()).toMatch(/grow_shell/);
  });

  it("show the model the measured problems, not just the plan", () => {
    const read = readBrief(STATED);
    const text = reviseInput(
      read.program,
      [
        {
          code: "room_small",
          severity: "warn",
          kinds: ["kitchen"],
          roomIds: ["kitchen.1"],
          measured: 0.7,
          target: 0.8,
          shortfall: 0.1,
          message: "Kitchen is 70% of its target size.",
        },
        {
          code: "room_oversized",
          severity: "info",
          kinds: ["lounge"],
          roomIds: [],
          measured: 1.6,
          target: 1.4,
          shortfall: 0,
          message: "Lounge is oversized.",
        },
      ],
      2,
    );
    expect(text).toContain("Kitchen is 70% of its target size.");
    expect(text).not.toContain("Lounge is oversized.");
    expect(text).toContain("Round 2");
  });
});

describe("the examples shown to the model", () => {
  it("are valid answers, so the instructions cannot drift from the schemas", async () => {
    const { PATCH_EXAMPLE, PROPOSAL_EXAMPLE, PatchSchema } = await import("../src");
    expect(ProposalSchema.safeParse(PROPOSAL_EXAMPLE).success).toBe(true);
    expect(PatchSchema.safeParse(PATCH_EXAMPLE).success).toBe(true);
    expect(proposeInstructions()).toContain(JSON.stringify(PROPOSAL_EXAMPLE));
    expect(reviseInstructions()).toContain(JSON.stringify(PATCH_EXAMPLE));
  });
});
