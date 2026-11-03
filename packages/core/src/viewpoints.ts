import type { Scene } from "./build/scene";
import type { Side } from "./geometry";
import type { FloorPlan, PlanRoom } from "./layout/types";

/** A standing camera at eye height, chosen from the plan so a good view needs no adjusting. */
export interface Viewpoint {
  id: string;
  name: string;
  /** Camera position in scene metres (plan x, up, plan y). */
  position: [number, number, number];
  /** What it looks at, in scene metres. */
  target: [number, number, number];
  fovDeg: number;
  /** The room this view is inside, when it has one. */
  roomId?: string;
}

export const EYE_HEIGHT_M = 1.6;
const LOOK_HEIGHT_M = 1.15;

const inward: Record<Side, [number, number]> = {
  north: [0, 1],
  south: [0, -1],
  west: [1, 0],
  east: [-1, 0],
};

function at(x: number, z: number): [number, number, number] {
  return [x, EYE_HEIGHT_M, z];
}

/** Is a point on the floor at least 0.35 m from every piece of furniture and fixture? */
function clearOf(scene: Scene | undefined) {
  const pieces = (scene?.nodes ?? []).filter(
    (n) => (n.type === "furniture" || n.type === "fixture") && n.geometry.kind !== "cylinder",
  );
  return (x: number, z: number) =>
    pieces.every((n) => {
      if (n.geometry.kind === "cylinder") return true;
      const [w, , d] = n.geometry.size;
      const dx = x - n.position[0];
      const dz = z - n.position[2];
      const cos = Math.cos(n.rotationY);
      const sin = Math.sin(n.rotationY);
      return (
        Math.abs(cos * dx - sin * dz) > w / 2 + 0.35 || Math.abs(sin * dx + cos * dz) > d / 2 + 0.35
      );
    });
}

/**
 * Standing inside the room, facing away from its door, so the walk camera behind the visitor looks
 * across the room from the door side. The deepest spot clear of furniture wins, up to 3 m in.
 */
function fromDoor(
  room: PlanRoom,
  name: string,
  clear: (x: number, z: number) => boolean,
): Viewpoint | undefined {
  const r = room.rect;
  const [nx, nz] = inward[room.door.side];
  const across = nx === 0 ? r.h : r.w;
  const inRoom = (x: number, z: number) =>
    x > r.x + 0.4 && x < r.x + r.w - 0.4 && z > r.y + 0.4 && z < r.y + r.h - 0.4;
  const depths: number[] = [];
  for (let depth = Math.min(3, across - 1.1); depth > 0.8; depth -= 0.3) depths.push(depth);
  for (const depth of [...depths, 0.8])
    for (const side of [0, 0.8, -0.8, 1.6, -1.6]) {
      const x = room.door.x + nx * depth + nz * side;
      const z = room.door.y + nz * depth + nx * side;
      if (!inRoom(x, z) || !clear(x, z)) continue;
      return {
        id: `room.${room.id}`,
        name,
        position: at(x, z),
        target: [x + nx * 2, LOOK_HEIGHT_M, z + nz * 2],
        fovDeg: 72,
        roomId: room.id,
      };
    }
  return undefined;
}

/**
 * The views worth showing: the entrance looking in, the open workspace from the corner that faces
 * the windows, and each reception, lounge, kitchen and meeting room from just inside its door.
 * Every room view stands clear of the furniture in `scene` when one is given.
 */
export function viewpoints(plan: FloorPlan, scene?: Scene): Viewpoint[] {
  const views: Viewpoint[] = [];
  const clear = clearOf(scene);
  const workspace = plan.rooms.find((r) => r.kind === "open_workspace");

  const { x, y, side } = plan.entrance;
  const [ex, ez] = inward[side];
  views.push({
    id: "view.entrance",
    name: "Entrance",
    position: at(x + ex * 0.9, y + ez * 0.9),
    target: [x + ex * 3, LOOK_HEIGHT_M, y + ez * 3],
    fovDeg: 72,
  });

  if (workspace) {
    const r = workspace.rect;
    const glazed = new Set(plan.shell.windows);
    // Stand on the side away from the windows so the view runs toward the light, far enough in
    // from the corner that the walk camera behind stays in the room.
    const standAt = (inset: number): [number, number] => [
      glazed.has("east") ? r.x + inset : glazed.has("west") ? r.x + r.w - inset : r.x + inset,
      glazed.has("south") ? r.y + inset : glazed.has("north") ? r.y + r.h - inset : r.y + inset,
    ];
    const most = Math.max(1.2, Math.min(3.2, r.w / 3, r.h / 3));
    let inset = most;
    while (inset > 1.2 && !clear(...standAt(inset))) inset -= 0.2;
    const [px, pz] = standAt(inset);
    const tx = px < r.x + r.w / 2 ? r.x + r.w - inset : r.x + inset;
    const tz = pz < r.y + r.h / 2 ? r.y + r.h - inset : r.y + inset;
    views.push({
      id: `room.${workspace.id}`,
      name: workspace.name,
      position: at(px, pz),
      target: [tx, LOOK_HEIGHT_M, tz],
      fovDeg: 76,
      roomId: workspace.id,
    });
  }

  const shown: PlanRoom["kind"][] = ["reception", "lounge", "kitchen", "meeting_room"];
  for (const kind of shown)
    for (const room of plan.rooms.filter((r) => r.kind === kind)) {
      const view = fromDoor(room, room.name, clear);
      if (view) views.push(view);
    }
  return views;
}
