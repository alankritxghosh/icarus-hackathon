import { type FloorPlan, layoutOffice, type Program, ProgramSchema } from "@icarus/core";

export const demoProgram = (): Program =>
  ProgramSchema.parse({
    company: { name: "Studio", headcount: 35 },
    shell: { widthM: 24, depthM: 16, windows: ["south", "east"], entrance: "west" },
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

let cache: { name: string; program: Program; plan: FloorPlan }[] | undefined;
export const plans = (): { name: string; program: Program; plan: FloorPlan }[] =>
  (cache ??= [
    ["demo studio", demoProgram()],
    ["small office", smallProgram()],
  ].map(([name, program]) => ({
    name: name as string,
    program: program as Program,
    plan: layoutOffice(program as Program, { seed: 1 }),
  })));

export function must<T>(v: T | undefined | null, what = "value"): T {
  if (v === undefined || v === null) throw new Error(`expected ${what}`);
  return v;
}
