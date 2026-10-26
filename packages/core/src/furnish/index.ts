import { buildShell, type Scene } from "../build";
import type { Rect } from "../geometry";
import type { FloorPlan } from "../layout/types";
import { expandRooms, type Program } from "../program";
import { applyStyle } from "../style";
import { type FurnishReport, furnishRoom } from "./kits";

export { ASSETS, type AssetKey, type AssetSpec } from "./catalog";
export type { FurnishReport } from "./kits";

import { doorClearance } from "./place";

export { Space } from "./place";

export interface Furnished {
  scene: Scene;
  /** Checked footprints per room and the door clearance each room keeps free. */
  checked: { roomId: string; rects: Rect[]; doorClearance: Rect }[];
  report: FurnishReport;
}

/** The shell plus furniture and lighting in every room. Deterministic for a plan. */
export function furnish(plan: FloorPlan, program: Program): Furnished {
  const scene = buildShell(plan);
  scene.materials = applyStyle(program.style);
  const report: FurnishReport = {
    seatsWanted: 0,
    seatsPlaced: 0,
    phoneBoothsWanted: 0,
    phoneBoothsPlaced: 0,
    meetingSeatsWanted: 0,
    meetingSeatsPlaced: 0,
  };
  const offices = program.rooms
    .filter((r) => r.kind === "private_office")
    .reduce((n, r) => n + r.count, 0);
  const seats = Math.max(1, program.company.headcount - offices);
  const capacity = new Map(expandRooms(program).map((r) => [r.id, r.capacity]));
  const checked: Furnished["checked"] = [];
  for (const room of plan.rooms) {
    const space = furnishRoom(
      room,
      plan.shell.ceilingM,
      { seats, booths: program.phoneBooths, capacity: capacity.get(room.id) },
      report,
    );
    scene.nodes.push(...space.nodes);
    checked.push({ roomId: room.id, rects: space.checked, doorClearance: doorClearance(room) });
  }
  return { scene, report, checked };
}
export { furnishingEvidence } from "./evidence";
