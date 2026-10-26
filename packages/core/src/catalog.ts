import type { Side } from "./geometry";

export const ROOM_KINDS = [
  "open_workspace",
  "meeting_room",
  "private_office",
  "kitchen",
  "lounge",
  "reception",
  "storage",
  "server_room",
  "restroom",
] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

export type Daylight = "required" | "preferred" | "avoid" | "none";

export interface KindRule {
  label: string;
  /** Smallest sensible clear width and depth in metres. */
  minWidth: number;
  minDepth: number;
  /** Longest side over shortest side that still reads as a usable room. */
  maxAspect: number;
  daylight: Daylight;
  /** How much a room may shrink below its target before the plan is flagged. */
  minScale: number;
  /** Kinds this room wants to share a wall with. */
  adjacent: RoomKind[];
}

/**
 * Planning rules of thumb for concept layouts. These are assumptions, not building-code values,
 * and the evidence panel labels them that way.
 */
export const KIND_RULES: Record<RoomKind, KindRule> = {
  open_workspace: {
    label: "Open workspace",
    minWidth: 6,
    minDepth: 5,
    maxAspect: 4.5,
    daylight: "required",
    minScale: 0.8,
    adjacent: ["kitchen", "lounge"],
  },
  meeting_room: {
    label: "Meeting room",
    minWidth: 2.7,
    minDepth: 3,
    maxAspect: 2.2,
    daylight: "preferred",
    minScale: 0.85,
    adjacent: ["open_workspace"],
  },
  private_office: {
    label: "Private office",
    minWidth: 2.7,
    minDepth: 3,
    maxAspect: 2.2,
    daylight: "preferred",
    minScale: 0.85,
    adjacent: [],
  },
  kitchen: {
    label: "Kitchen",
    minWidth: 3,
    minDepth: 3,
    maxAspect: 3,
    daylight: "preferred",
    minScale: 0.8,
    adjacent: ["lounge"],
  },
  lounge: {
    label: "Lounge",
    minWidth: 4,
    minDepth: 3.5,
    maxAspect: 3,
    daylight: "preferred",
    minScale: 0.8,
    adjacent: ["kitchen"],
  },
  reception: {
    label: "Reception",
    minWidth: 3.5,
    minDepth: 3.5,
    maxAspect: 2.5,
    daylight: "preferred",
    minScale: 0.8,
    adjacent: [],
  },
  storage: {
    label: "Storage",
    minWidth: 1.5,
    minDepth: 2,
    maxAspect: 3,
    daylight: "avoid",
    minScale: 0.7,
    adjacent: [],
  },
  server_room: {
    label: "Server room",
    minWidth: 1.8,
    minDepth: 2,
    maxAspect: 3,
    daylight: "avoid",
    minScale: 0.7,
    adjacent: [],
  },
  restroom: {
    label: "Restroom",
    minWidth: 2,
    minDepth: 2.4,
    maxAspect: 3,
    daylight: "none",
    minScale: 0.8,
    adjacent: ["restroom"],
  },
};

export interface AreaRule {
  /** Rule used to size the room, shown to the user. */
  basis: string;
  /** Target area in square metres for the given headcount and capacity. */
  area: (headcount: number, capacity: number) => number;
}

export const AREA_RULES: Record<RoomKind, AreaRule> = {
  open_workspace: {
    basis: "6.0 m2 per person for desks and local circulation",
    area: (n) => Math.max(18, 6 * n),
  },
  meeting_room: { basis: "2 m2 per seat plus 3 m2", area: (_n, cap) => Math.max(9, 2 * cap + 3) },
  private_office: { basis: "10 m2 each", area: () => 10 },
  kitchen: { basis: "8 m2 plus 0.35 m2 per person", area: (n) => Math.max(10, 8 + 0.35 * n) },
  lounge: { basis: "0.6 m2 per person, at least 12 m2", area: (n) => Math.max(12, 0.6 * n) },
  reception: { basis: "14 m2", area: () => 14 },
  storage: { basis: "8 m2", area: () => 8 },
  server_room: { basis: "6 m2", area: () => 6 },
  restroom: { basis: "7 m2 plus 0.1 m2 per person", area: (n) => 7 + 0.1 * n },
};

export const OPPOSITE: Record<Side, Side> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};
