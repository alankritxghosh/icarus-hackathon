import { KIND_RULES, type RoomKind } from "../catalog";
import { exposureOnSide, facingSpan, type Rect, type Side } from "../geometry";
import type { PlannedRoom, Preferences } from "../program";
import type { Realized } from "./realize";
import { LOBBY_WIDTH_M } from "./types";

export interface CostContext {
  rooms: Map<string, PlannedRoom>;
  W: number;
  D: number;
  /** Window sides in the canonical frame. */
  windows: Side[];
  /** Extra neighbours and separations asked for by the design. */
  preferences?: Preferences;
}

export interface CostBreakdown {
  total: number;
  shrink: number;
  aspect: number;
  depth: number;
  daylight: number;
  adjacency: number;
  entrance: number;
  crowded: number;
}

const EPS = 1e-6;

/** Rooms count as adjacent when they share a wall or face each other across a corridor. */
export const ADJACENT_GAP_M = 1.7;

export function daylightExposure(
  rect: Rect,
  ctx: { W: number; D: number; windows: Side[] },
): number {
  return ctx.windows.reduce((s, side) => s + exposureOnSide(rect, { w: ctx.W, h: ctx.D }, side), 0);
}

export function wantedNeighbours(kind: RoomKind): RoomKind[] {
  return KIND_RULES[kind].adjacent;
}

/**
 * Cost of a realized plan, lower is better. Every term measures something the user can check on
 * the plan, and the evidence panel reports the same quantities, so the search optimises exactly
 * what is shown.
 */
export function planCost(realized: Realized, ctx: CostContext): CostBreakdown {
  const c: CostBreakdown = {
    total: 0,
    shrink: 0,
    aspect: 0,
    depth: 0,
    daylight: 0,
    adjacency: 0,
    entrance: 0,
    crowded: realized.crowded ? 200 : 0,
  };
  for (const [id, rect] of realized.rects) {
    const room = ctx.rooms.get(id);
    if (!room) continue;
    const rule = KIND_RULES[room.kind];
    const scale = (rect.w * rect.h) / room.targetAreaM2;
    c.shrink +=
      (1 - scale) ** 2 * 6 +
      (scale < rule.minScale ? (rule.minScale - scale) * 40 : 0) +
      (scale > 1.25 ? (scale - 1.25) * 24 : 0);
    const aspect = Math.max(rect.w / rect.h, rect.h / rect.w);
    if (aspect > rule.maxAspect) c.aspect += (aspect - rule.maxAspect) * 6;
    if (rect.h < rule.minDepth) c.depth += (rule.minDepth - rect.h) * 25;
    const perimeterReach = Math.min(rect.w, rect.h);
    const exposure = daylightExposure(rect, ctx);
    if (rule.daylight === "required")
      c.daylight += 10 * (1 - Math.min(1, exposure / perimeterReach));
    else if (rule.daylight === "preferred")
      c.daylight += 2 * (1 - Math.min(1, exposure / perimeterReach));
    else if (rule.daylight === "avoid" && exposure > EPS) c.daylight += 1.5;
    if (room.kind === "reception" && rect.x > LOBBY_WIDTH_M + EPS) c.entrance += 12;
    const wanted = [
      ...wantedNeighbours(room.kind).map((kind) => ({ kind, weight: 1 })),
      ...(ctx.preferences?.adjacent ?? [])
        .filter((p) => p.a === room.kind)
        .map((p) => ({ kind: p.b, weight: p.weight })),
    ];
    for (const want of wanted) {
      const others = [...realized.rects].filter(
        ([oid]) => oid !== id && ctx.rooms.get(oid)?.kind === want.kind,
      );
      if (others.length === 0) continue;
      const touching = others.some(([, r]) => facingSpan(rect, r, ADJACENT_GAP_M) >= 1.5);
      if (!touching) {
        const nearest = Math.min(
          ...others.map(([, r]) =>
            Math.hypot(
              rect.x + rect.w / 2 - (r.x + r.w / 2),
              rect.y + rect.h / 2 - (r.y + r.h / 2),
            ),
          ),
        );
        c.adjacency += want.weight * (2.5 + (3 * nearest) / ctx.W);
      }
    }
    for (const keep of (ctx.preferences?.apart ?? []).filter((p) => p.a === room.kind)) {
      const touching = [...realized.rects].some(
        ([oid, r]) =>
          oid !== id &&
          ctx.rooms.get(oid)?.kind === keep.b &&
          facingSpan(rect, r, ADJACENT_GAP_M) >= 1.5,
      );
      if (touching) c.adjacency += 4 * keep.weight;
    }
  }
  c.total = c.shrink + c.aspect + c.depth + c.daylight + c.adjacency + c.entrance + c.crowded;
  return c;
}
