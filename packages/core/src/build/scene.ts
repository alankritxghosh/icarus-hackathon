import type { RoomKind } from "../catalog";

/**
 * The 3D office as a flat list of simple shapes, in metres. Plan x is 3D x, plan y is 3D z, and
 * y is up. Positions are the centre of each shape. Boxes and cylinders are enough for walls,
 * floors, furniture and fixtures, and they map directly to a three.js scene and to a GLB.
 */
export type Geometry =
  | { kind: "box"; size: [number, number, number] }
  | { kind: "cylinder"; radius: number; height: number };

export type NodeType =
  | "floor"
  | "ceiling"
  | "wall"
  | "door"
  | "window"
  | "frame"
  | "furniture"
  | "fixture"
  | "light";

export interface SceneNode {
  id: string;
  name: string;
  type: NodeType;
  /** The room (or circulation space) this belongs to, when it belongs to one. */
  roomId?: string;
  roomKind?: RoomKind;
  geometry: Geometry;
  position: [number, number, number];
  /** Rotation about the vertical axis, in radians. */
  rotationY: number;
  material: string;
  tags: string[];
}

export interface MaterialDef {
  color: string;
  roughness: number;
  metalness: number;
  opacity: number;
  /** Emits light in the viewer. */
  emissive?: string;
}

export interface Scene {
  ceilingM: number;
  nodes: SceneNode[];
  materials: Record<string, MaterialDef>;
  /** Clear plan size of the shell in metres. */
  shell: { w: number; h: number };
}

export const MATERIALS: Record<string, MaterialDef> = {
  "wall.interior": { color: "#f1efe9", roughness: 0.9, metalness: 0, opacity: 1 },
  "wall.exterior": { color: "#d8d4cb", roughness: 0.85, metalness: 0, opacity: 1 },
  ceiling: { color: "#faf9f6", roughness: 0.95, metalness: 0, opacity: 1 },
  glass: { color: "#a9cfe0", roughness: 0.05, metalness: 0, opacity: 0.28 },
  "door.wood": { color: "#a67c52", roughness: 0.6, metalness: 0, opacity: 1 },
  "frame.metal": { color: "#2b2f33", roughness: 0.45, metalness: 0.7, opacity: 1 },
  "floor.carpet": { color: "#7f8b96", roughness: 1, metalness: 0, opacity: 1 },
  "floor.carpet.warm": { color: "#9a8a7c", roughness: 1, metalness: 0, opacity: 1 },
  "floor.tile": { color: "#d6d8d6", roughness: 0.4, metalness: 0, opacity: 1 },
  "floor.wood": { color: "#b48a5e", roughness: 0.6, metalness: 0, opacity: 1 },
  "floor.wood.light": { color: "#cdb18a", roughness: 0.55, metalness: 0, opacity: 1 },
  "floor.concrete": { color: "#a9a8a3", roughness: 0.8, metalness: 0, opacity: 1 },
  "floor.corridor": { color: "#bdbab2", roughness: 0.75, metalness: 0, opacity: 1 },
};

/** Floor finish by room kind. A concept palette, easy to change later. */
export const FLOOR_BY_KIND: Record<RoomKind, string> = {
  open_workspace: "floor.carpet",
  meeting_room: "floor.carpet.warm",
  private_office: "floor.carpet.warm",
  kitchen: "floor.tile",
  lounge: "floor.wood",
  reception: "floor.wood.light",
  storage: "floor.concrete",
  server_room: "floor.concrete",
  restroom: "floor.tile",
};
