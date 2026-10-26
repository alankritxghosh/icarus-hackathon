import type { RoomKind } from "../catalog";
import type { Rect, Side } from "../geometry";

export interface Door {
  /** The wall of the room the door is cut into. */
  side: Side;
  /** Centre of the door in plan metres. */
  x: number;
  y: number;
  widthM: number;
  /** The circulation space it opens onto. */
  opensTo: string;
}

export interface PlanRoom {
  id: string;
  kind: RoomKind;
  name: string;
  rect: Rect;
  targetAreaM2: number;
  door: Door;
}

export interface Circulation {
  id: string;
  kind: "corridor" | "lobby";
  rect: Rect;
}

export interface Diagnostic {
  level: "info" | "warn" | "fail";
  message: string;
  room?: string;
}

export interface FloorPlan {
  shell: { w: number; h: number; ceilingM: number; windows: Side[]; entrance: Side };
  rooms: PlanRoom[];
  circulation: Circulation[];
  /** The front door, in plan metres. */
  entrance: { side: Side; x: number; y: number; widthM: number };
  diagnostics: Diagnostic[];
  /** The search that produced this plan: reproducible from these. */
  search: { seed: number; rows: string[][]; cost: number };
}

export const CORRIDOR_WIDTH_M = 1.6;
export const LOBBY_WIDTH_M = 2.0;
export const ENTRANCE_WIDTH_M = 1.8;
