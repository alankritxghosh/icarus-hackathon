import { describe, expect, it } from "vitest";
import { readBrief } from "../src";

const DEMO =
  "A 35-person design studio. Open studio, three meeting rooms, two phone booths, a kitchen and lounge, reception, storage and server closet, restrooms. 24 m by 16 m shell, windows on south and east walls, entrance on the west.";

describe("readBrief", () => {
  it("reads every stated fact", () => {
    const { program } = readBrief(DEMO);
    expect(program.company.headcount).toBe(35);
    expect(program.shell).toMatchObject({ widthM: 24, depthM: 16, entrance: "west" });
    expect([...program.shell.windows].sort()).toEqual(["east", "south"]);
    expect(program.phoneBooths).toBe(2);
    expect(program.rooms.find((r) => r.kind === "meeting_room")?.count).toBe(3);
    for (const kind of ["kitchen", "lounge", "reception", "storage", "server_room"])
      expect(program.rooms.some((r) => r.kind === kind)).toBe(true);
  });

  it("records what it had to assume instead of inventing silently", () => {
    const { program } = readBrief("An office for 20 people");
    const catalog = program.assumptions.filter((a) => a.source === "catalog").map((a) => a.topic);
    expect(catalog).toEqual(
      expect.arrayContaining(["shell", "windows", "entrance", "meeting rooms"]),
    );
    expect(program.assumptions.find((a) => a.topic === "headcount")?.source).toBe("brief");
  });

  it("always yields a valid program, even for a vague brief", () => {
    for (const text of ["", "office", "a tiny 3 person shop", "500 people 80 m by 80 m"]) {
      const { program } = readBrief(text);
      expect(program.rooms.some((r) => r.kind === "restroom")).toBe(true);
    }
  });
});
