import { makeFrame } from "./frame";
import type { FloorPlan } from "./types";

const SAME_ROW_M = 0.002;

/**
 * The rows of rooms a plan is made of, read back from its geometry: room ids in the solver's
 * canonical frame, rows from the entrance-side wall inward, rooms left to right within a row. For a
 * plan the layout engine made, this is the order it was realized from (`plan.search.rows`), so an
 * office does not need to carry that order with it. A plan that was not made from rows (rooms moved
 * by hand, a curved wall) gives a result that does not reproduce it; callers check by planning
 * again, as `editModel` does.
 */
export function arrangementOf(plan: FloorPlan): string[][] {
  const frame = makeFrame({ w: plan.shell.w, h: plan.shell.h }, plan.shell.entrance);
  const placed = plan.rooms
    .map((r) => ({ id: r.id, rect: frame.rect(r.rect) }))
    .sort((a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x);
  const rows: { y: number; rooms: typeof placed }[] = [];
  for (const room of placed) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(room.rect.y - row.y) <= SAME_ROW_M) row.rooms.push(room);
    else rows.push({ y: room.rect.y, rooms: [room] });
  }
  return rows.map((row) => row.rooms.sort((a, b) => a.rect.x - b.rect.x).map((r) => r.id));
}
