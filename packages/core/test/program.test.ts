import { describe, expect, it } from "vitest";
import { checkProgram, expandRooms, ProgramSchema } from "../src";
import { demoProgram } from "./fixtures";

describe("program", () => {
  it("expands counts into individual rooms with sizes and the rule behind each", () => {
    const rooms = expandRooms(demoProgram());
    expect(rooms.map((r) => r.id)).toEqual([
      "open_workspace.1",
      "meeting_room.1",
      "meeting_room.2",
      "meeting_room.3",
      "kitchen.1",
      "lounge.1",
      "reception.1",
      "storage.1",
      "server_room.1",
      "restroom.1",
      "restroom.2",
    ]);
    const byId = new Map(rooms.map((r) => [r.id, r]));
    expect(byId.get("open_workspace.1")?.targetAreaM2).toBe(210);
    expect(byId.get("meeting_room.2")?.targetAreaM2).toBe(15);
    expect(byId.get("meeting_room.2")?.name).toBe("Meeting room 2");
    expect(byId.get("kitchen.1")?.targetAreaM2).toBeCloseTo(20.3, 1);
    expect(byId.get("lounge.1")?.targetAreaM2).toBe(21);
    expect(byId.get("restroom.1")?.targetAreaM2).toBeCloseTo(10.5, 1);
    expect(rooms.every((r) => r.basis.length > 0)).toBe(true);
  });

  it("uses a size stated in the brief instead of the catalog rule, and says so", () => {
    const program = ProgramSchema.parse({
      company: { headcount: 10 },
      shell: { widthM: 12, depthM: 9, entrance: "west" },
      rooms: [{ kind: "open_workspace", areaM2: 80 }],
    });
    const [room] = expandRooms(program);
    expect(room).toMatchObject({ targetAreaM2: 80, basis: "stated in the brief" });
  });

  it("is deterministic", () => {
    expect(expandRooms(demoProgram())).toEqual(expandRooms(demoProgram()));
  });

  it("rejects programs that make no sense at the boundary", () => {
    const base = {
      company: { headcount: 10 },
      shell: { widthM: 12, depthM: 9, entrance: "west" },
      rooms: [{ kind: "open_workspace" }],
    };
    expect(ProgramSchema.safeParse(base).success).toBe(true);
    expect(ProgramSchema.safeParse({ ...base, company: { headcount: 1 } }).success).toBe(false);
    expect(ProgramSchema.safeParse({ ...base, shell: { ...base.shell, widthM: 3 } }).success).toBe(
      false,
    );
    expect(
      ProgramSchema.safeParse({ ...base, shell: { ...base.shell, entrance: "up" } }).success,
    ).toBe(false);
    expect(ProgramSchema.safeParse({ ...base, rooms: [{ kind: "ballroom" }] }).success).toBe(false);
    expect(ProgramSchema.safeParse({ ...base, rooms: [] }).success).toBe(false);
  });

  it("flags a program with no workspace, no restroom, or too much for the shell", () => {
    const problems = checkProgram(
      ProgramSchema.parse({
        company: { headcount: 50 },
        shell: { widthM: 8, depthM: 8, entrance: "west" },
        rooms: [{ kind: "kitchen" }],
      }),
    );
    expect(problems.join(" ")).toMatch(/no workspace/);
    expect(problems.join(" ")).toMatch(/no restroom/);
    expect(checkProgram(demoProgram())).toEqual([]);
    const tight = checkProgram(demoProgram({ widthM: 16, depthM: 12 }));
    expect(tight.join(" ")).toMatch(/shell/);
  });
});
