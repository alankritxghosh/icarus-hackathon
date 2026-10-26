import type { Side } from "./geometry";

import { KNOWLEDGE, ROOM_KINDS, type RoomKind } from "./knowledge";

export { ROOM_KINDS, type RoomKind };

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
 * Planning rules of thumb for concept layouts, read from the knowledge file
 * (`knowledge/office.v1.json`). They are assumptions, not building-code values, and the evidence
 * panel labels them that way.
 */
export const KIND_RULES: Record<RoomKind, KindRule> = Object.fromEntries(
  ROOM_KINDS.map((kind) => {
    const r = KNOWLEDGE.rooms[kind];
    return [
      kind,
      {
        label: r.label,
        minWidth: r.minWidthM,
        minDepth: r.minDepthM,
        maxAspect: r.maxAspect,
        daylight: r.daylight,
        minScale: r.minScale,
        adjacent: r.adjacent,
      },
    ];
  }),
) as Record<RoomKind, KindRule>;

export interface AreaRule {
  /** Rule used to size the room, shown to the user. */
  basis: string;
  /** Target area in square metres for the given headcount and capacity. */
  area: (headcount: number, capacity: number) => number;
}

export const AREA_RULES: Record<RoomKind, AreaRule> = Object.fromEntries(
  ROOM_KINDS.map((kind) => {
    const a = KNOWLEDGE.rooms[kind].area;
    return [
      kind,
      {
        basis: a.basis,
        area: (n: number, cap: number) =>
          Math.max(a.minM2 ?? 0, a.baseM2 + (a.perPersonM2 ?? 0) * n + (a.perSeatM2 ?? 0) * cap),
      },
    ];
  }),
) as Record<RoomKind, AreaRule>;

export const OPPOSITE: Record<Side, Side> = {
  north: "south",
  south: "north",
  east: "west",
  west: "east",
};
