import { type Program, ProgramSchema } from "../src";

export const demoProgram = (over: Partial<Program["shell"]> = {}): Program =>
  ProgramSchema.parse({
    company: { name: "Studio", headcount: 35 },
    shell: { widthM: 24, depthM: 16, windows: ["south", "east"], entrance: "west", ...over },
    rooms: [
      { kind: "open_workspace" },
      { kind: "meeting_room", count: 3, capacity: 6 },
      { kind: "kitchen" },
      { kind: "lounge" },
      { kind: "reception" },
      { kind: "storage" },
      { kind: "server_room" },
      { kind: "restroom", count: 2 },
    ],
    phoneBooths: 2,
  });

export const smallProgram = (): Program =>
  ProgramSchema.parse({
    company: { headcount: 8 },
    shell: { widthM: 12, depthM: 9, windows: ["north"], entrance: "south" },
    rooms: [
      { kind: "open_workspace" },
      { kind: "meeting_room", capacity: 4 },
      { kind: "restroom" },
      { kind: "reception" },
    ],
  });

/** Unwrap a value a test expects to exist, failing with a clear message if it does not. */
export function must<T>(value: T | undefined | null, what = "value"): T {
  if (value === undefined || value === null) throw new Error(`expected ${what} to exist`);
  return value;
}
