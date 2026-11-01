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

/** Standing against the wall opposite the door, looking back across the room towards it. */
function fromFarWall(room: PlanRoom, name: string, fovDeg = 74): Viewpoint {
  const r = room.rect;
  const cx = r.x + r.w / 2;
  const cz = r.y + r.h / 2;
  const edge = 0.5;
  const stands: Record<Side, [number, number]> = {
    north: [cx, r.y + r.h - edge],
    south: [cx, r.y + edge],
    west: [r.x + r.w - edge, cz],
    east: [r.x + edge, cz],
  };
  const [px, pz] = stands[room.door.side];
  return {
    id: `view.${room.id}`,
    name,
    position: at(px, pz),
    target: [room.door.x, LOOK_HEIGHT_M, room.door.y],
    fovDeg,
    roomId: room.id,
  };
}

/**
 * The views worth showing: the entrance looking in, the open workspace from the corner that faces
 * the windows, and each lounge, kitchen, reception and the first meeting room from the wall opposite its door.
 */
export function viewpoints(plan: FloorPlan): Viewpoint[] {
  const views: Viewpoint[] = [];
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
    const inset = 1.2;
    // Stand on the side away from the windows so the view runs toward the light.
    const px = glazed.has("east")
      ? r.x + inset
      : glazed.has("west")
        ? r.x + r.w - inset
        : r.x + inset;
    const pz = glazed.has("south")
      ? r.y + inset
      : glazed.has("north")
        ? r.y + r.h - inset
        : r.y + inset;
    const tx = px < r.x + r.w / 2 ? r.x + r.w - inset : r.x + inset;
    const tz = pz < r.y + r.h / 2 ? r.y + r.h - inset : r.y + inset;
    views.push({
      id: `view.${workspace.id}`,
      name: "Open workspace",
      position: at(px, pz),
      target: [tx, LOOK_HEIGHT_M, tz],
      fovDeg: 76,
      roomId: workspace.id,
    });
  }

  const named: [PlanRoom["kind"], string][] = [
    ["reception", "Reception"],
    ["lounge", "Lounge"],
    ["kitchen", "Kitchen"],
    ["meeting_room", "Meeting room"],
  ];
  for (const [kind, name] of named) {
    const room = plan.rooms.find((r) => r.kind === kind);
    if (room) views.push(fromFarWall(room, name));
  }
  return views;
}
