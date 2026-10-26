import type { RoomKind } from "../catalog";

/**
 * The 3D office as a flat list of simple shapes, in metres. Plan x is 3D x, plan y is 3D z, and
 * y is up. Positions are the centre of each shape. Boxes and cylinders are enough for walls,
 * floors, furniture and fixtures, and they map directly to a three.js scene and to a GLB.
 */
export type Geometry =
  | { kind: "box"; size: [number, number, number] }
  | { kind: "cylinder"; radius: number; height: number }
  /**
   * A modelled object loaded by id. `size` is its footprint and height in metres (x, y, z). The
   * node position is the centre of the footprint on the floor (or the top for hanging fixtures);
   * the viewer centres the model on it and rests it there.
   */
  | { kind: "asset"; id: string; size: [number, number, number] };

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
  /** A procedural surface the viewer draws: board planks or woven carpet. */
  texture?: "planks" | "carpet";
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
  "floor.oak": { color: "#c79d6a", texture: "planks", roughness: 0.55, metalness: 0, opacity: 1 },
  "floor.oak.light": {
    color: "#d9bd92",
    texture: "planks",
    roughness: 0.55,
    metalness: 0,
    opacity: 1,
  },
  "floor.carpet.green": {
    color: "#6d8c76",
    texture: "carpet",
    roughness: 1,
    metalness: 0,
    opacity: 1,
  },
  "floor.carpet": { color: "#7f8b96", roughness: 1, metalness: 0, opacity: 1 },
  "floor.carpet.warm": { color: "#9a8a7c", roughness: 1, metalness: 0, opacity: 1 },
  "floor.tile": { color: "#d6d8d6", roughness: 0.4, metalness: 0, opacity: 1 },
  "floor.wood": { color: "#b48a5e", roughness: 0.6, metalness: 0, opacity: 1 },
  "floor.wood.light": { color: "#cdb18a", roughness: 0.55, metalness: 0, opacity: 1 },
  "floor.concrete": { color: "#a9a8a3", roughness: 0.8, metalness: 0, opacity: 1 },
  oak: { color: "#c9a273", roughness: 0.5, metalness: 0, opacity: 1 },
  "oak.dark": { color: "#8a6a47", roughness: 0.55, metalness: 0, opacity: 1 },
  "fabric.green": { color: "#4d7558", roughness: 0.95, metalness: 0, opacity: 1 },
  "fabric.charcoal": { color: "#383d3b", roughness: 0.95, metalness: 0, opacity: 1 },
  "felt.green": { color: "#3d6a4d", roughness: 1, metalness: 0, opacity: 1 },
  "metal.black": { color: "#1f2326", roughness: 0.45, metalness: 0.7, opacity: 1 },
  steel: { color: "#b9bdc0", roughness: 0.35, metalness: 0.85, opacity: 1 },
  "laminate.white": { color: "#f2f1ee", roughness: 0.5, metalness: 0, opacity: 1 },
  terrazzo: { color: "#d2cbbf", roughness: 0.35, metalness: 0, opacity: 1 },
  screen: { color: "#0d1012", roughness: 0.2, metalness: 0.3, opacity: 1 },
  "light.warm": {
    color: "#fff1d0",
    roughness: 0.4,
    metalness: 0,
    opacity: 1,
    emissive: "#ffe2a8",
  },
  "floor.corridor": { color: "#cdbfa7", roughness: 0.7, metalness: 0, opacity: 1 },
};

/** Floor finish by room kind. A concept palette, easy to change later. */
export const FLOOR_BY_KIND: Record<RoomKind, string> = {
  open_workspace: "floor.oak",
  meeting_room: "floor.carpet.green",
  private_office: "floor.carpet.green",
  kitchen: "floor.tile",
  lounge: "floor.oak.light",
  reception: "floor.oak.light",
  storage: "floor.concrete",
  server_room: "floor.concrete",
  restroom: "floor.tile",
};
