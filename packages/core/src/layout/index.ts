import { KIND_RULES } from "../catalog";
import type { Side } from "../geometry";
import { checkProgram, expandRooms, type PlannedRoom, type Program } from "../program";
import { type CostBreakdown, planCost } from "./cost";
import { makeFrame } from "./frame";
import { realize } from "./realize";
import { searchLayout } from "./search";
import {
  type Circulation,
  type Diagnostic,
  ENTRANCE_WIDTH_M,
  type FloorPlan,
  type PlanRoom,
} from "./types";

export { rng } from "./search";
export { snapPlanToMm } from "./snap";
export * from "./types";

export interface LayoutOptions {
  seed?: number;
  iterations?: number;
  restarts?: number;
}

const DOOR_WIDTH_M = 0.9;
const WIDE_DOOR_M = 1.8;

/** The arrangement as rows of ids, if it names exactly the planned rooms once each. */
function usableArrangement(
  arrangement: string[][] | undefined,
  rooms: Map<string, PlannedRoom>,
): string[][] | undefined {
  if (!arrangement) return undefined;
  const ids = arrangement.flat();
  if (ids.length !== rooms.size || new Set(ids).size !== ids.length) return undefined;
  if (!ids.every((id) => rooms.has(id))) return undefined;
  return arrangement.map((row) => [...row]);
}

/**
 * Plan a whole office inside the shell. Deterministic for a given seed. The result is always
 * geometry the evidence module can measure; where the program cannot fit, the plan is still
 * produced and the diagnostics say what gave way, instead of pretending it fits.
 */
export function layoutOffice(
  program: Program,
  options: LayoutOptions = {},
): FloorPlan & { breakdown: CostBreakdown } {
  const planned = expandRooms(program);
  // The solver sees targets nudged by the design's area bias; every report below uses the unbiased ones.
  const bias = program.preferences.areaScale;
  const rooms = new Map<string, PlannedRoom>(
    planned.map((room) => [
      room.id,
      { ...room, targetAreaM2: room.targetAreaM2 * (bias[room.kind] ?? 1) },
    ]),
  );
  const base = new Map<string, PlannedRoom>(planned.map((room) => [room.id, room]));
  const shell = { w: program.shell.widthM, h: program.shell.depthM };
  const frame = makeFrame(shell, program.shell.entrance);
  const windows = program.shell.windows.map((side) => frame.side(side));
  const seed = options.seed ?? 1;
  const ctx = { rooms, W: frame.W, D: frame.D, windows, preferences: program.preferences };
  const fixed = usableArrangement(program.arrangement, rooms);
  const found = fixed
    ? { rows: fixed, cost: planCost(realize(fixed, rooms, frame.W, frame.D), ctx) }
    : searchLayout(ctx, { seed, iterations: options.iterations, restarts: options.restarts });
  const real = realize(found.rows, rooms, frame.W, frame.D);

  const diagnostics: Diagnostic[] = checkProgram(program).map((message) => ({
    level: "warn",
    message,
  }));
  if (program.arrangement && !fixed)
    diagnostics.push({
      level: "info",
      message:
        "The arranged order of rooms no longer matches the program, so the plan was searched afresh.",
    });
  const out: PlanRoom[] = [];
  const k = found.rows.length;
  found.rows.forEach((row, b) => {
    for (const id of row) {
      const room = base.get(id) as PlannedRoom;
      const canon = real.rects.get(id);
      if (!canon) continue;
      const toLobby = room.kind === "reception";
      const towardNorth = b === k - 1 && k > 1;
      const cside: Side = toLobby ? "west" : towardNorth ? "north" : "south";
      const corridorIndex = towardNorth ? b - 1 : b;
      const cx = Math.min(Math.max(canon.x + canon.w / 2, canon.x + 0.7), canon.x + canon.w - 0.7);
      const [dx, dy] = toLobby
        ? frame.unpoint(canon.x, canon.y + canon.h / 2)
        : frame.unpoint(cx, cside === "south" ? canon.y + canon.h : canon.y);
      out.push({
        id,
        kind: room.kind,
        name: room.name,
        rect: frame.unrect(canon),
        targetAreaM2: room.targetAreaM2,
        door: {
          side: frame.unside(cside),
          x: dx,
          y: dy,
          widthM:
            room.kind === "open_workspace" || room.kind === "reception"
              ? WIDE_DOOR_M
              : DOOR_WIDTH_M,
          opensTo: toLobby ? "lobby" : `corridor.${corridorIndex}`,
        },
      });
      const rule = KIND_RULES[room.kind];
      const scale = (canon.w * canon.h) / room.targetAreaM2;
      if (scale < rule.minScale)
        diagnostics.push({
          level: "warn",
          room: id,
          message: `${room.name} is ${Math.round(scale * 100)}% of its target size, below the ${Math.round(rule.minScale * 100)}% this kind of room should keep.`,
        });
      if (canon.h < rule.minDepth - 1e-6)
        diagnostics.push({
          level: "warn",
          room: id,
          message: `${room.name} is only ${canon.h.toFixed(1)} m deep; ${rule.minDepth} m is the least that works.`,
        });
      if (canon.w < rule.minWidth - 1e-6)
        diagnostics.push({
          level: "warn",
          room: id,
          message: `${room.name} is only ${canon.w.toFixed(1)} m wide; ${rule.minWidth} m is the least that works.`,
        });
    }
  });
  if (real.crowded)
    diagnostics.push({
      level: "fail",
      message:
        "Some rows cannot fit their rooms even at minimum widths. Enlarge the shell or remove rooms.",
    });

  const circulation: Circulation[] = [
    { id: "lobby", kind: "lobby", rect: frame.unrect(real.lobby) },
    ...real.corridors.map(
      (rect, i): Circulation => ({
        id: `corridor.${i}`,
        kind: "corridor",
        rect: frame.unrect(rect),
      }),
    ),
  ];
  const [ex, ey] = frame.unpoint(0, frame.D / 2);
  diagnostics.push({
    level: "info",
    message: `The front door is placed at the middle of the ${program.shell.entrance} wall, on the entrance lobby; an offset along the wall is not used.`,
  });

  return {
    shell: {
      w: shell.w,
      h: shell.h,
      ceilingM: program.shell.ceilingM,
      windows: program.shell.windows,
      entrance: program.shell.entrance,
    },
    rooms: out,
    circulation,
    entrance: { side: program.shell.entrance, x: ex, y: ey, widthM: ENTRANCE_WIDTH_M },
    diagnostics,
    search: { seed, rows: found.rows, cost: found.cost.total },
    breakdown: found.cost,
  };
}
