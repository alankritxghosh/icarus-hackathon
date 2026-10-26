import { type Program, ProgramSchema, type RoomKind, type Side } from "@icarus/core";

export const SIDES: Side[] = ["north", "south", "east", "west"];

export interface Form {
  headcount: number;
  width: number;
  depth: number;
  ceiling: number;
  windows: Record<Side, boolean>;
  entrance: Side;
  meetingRooms: number;
  meetingCapacity: number;
  privateOffices: number;
  phoneBooths: number;
  restrooms: number;
  optional: Record<"kitchen" | "lounge" | "reception" | "storage" | "server_room", boolean>;
  seed: number;
}

export const OPTIONAL_LABEL: Record<keyof Form["optional"], string> = {
  kitchen: "Kitchen",
  lounge: "Lounge",
  reception: "Reception",
  storage: "Storage",
  server_room: "Server closet",
};

const count = (p: Program, kind: RoomKind) => p.rooms.find((r) => r.kind === kind)?.count ?? 0;

export function fromProgram(p: Program, seed: number): Form {
  const has = (kind: RoomKind) => p.rooms.some((r) => r.kind === kind);
  return {
    headcount: p.company.headcount,
    width: p.shell.widthM,
    depth: p.shell.depthM,
    ceiling: p.shell.ceilingM,
    windows: Object.fromEntries(SIDES.map((s) => [s, p.shell.windows.includes(s)])) as Record<
      Side,
      boolean
    >,
    entrance: p.shell.entrance,
    meetingRooms: count(p, "meeting_room"),
    meetingCapacity: p.rooms.find((r) => r.kind === "meeting_room")?.capacity ?? 6,
    privateOffices: count(p, "private_office"),
    phoneBooths: p.phoneBooths,
    restrooms: count(p, "restroom"),
    optional: {
      kitchen: has("kitchen"),
      lounge: has("lounge"),
      reception: has("reception"),
      storage: has("storage"),
      server_room: has("server_room"),
    },
    seed,
  };
}

/** The validated program for a form, or the reasons it is not valid. */
export function toProgram(f: Form, assumptions: Program["assumptions"]) {
  const rooms: unknown[] = [{ kind: "open_workspace" }];
  if (f.meetingRooms > 0)
    rooms.push({ kind: "meeting_room", count: f.meetingRooms, capacity: f.meetingCapacity });
  if (f.privateOffices > 0) rooms.push({ kind: "private_office", count: f.privateOffices });
  for (const kind of Object.keys(f.optional) as (keyof Form["optional"])[])
    if (f.optional[kind]) rooms.push({ kind });
  if (f.restrooms > 0) rooms.push({ kind: "restroom", count: f.restrooms });
  return ProgramSchema.safeParse({
    company: { headcount: f.headcount },
    shell: {
      widthM: f.width,
      depthM: f.depth,
      ceilingM: f.ceiling,
      windows: SIDES.filter((s) => f.windows[s]),
      entrance: f.entrance,
    },
    rooms,
    phoneBooths: f.phoneBooths,
    assumptions,
  });
}
