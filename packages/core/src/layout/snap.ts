import type { FloorPlan } from "./types";

const mm = (m: number) => Math.round(m * 1000);
const grid = (m: number) => mm(m) / 1000;

/**
 * The plan with every position and size on the millimetre grid. The solver works in floating
 * point, which leaves edges a fraction of a millimetre off the grid; measuring such a plan can tip
 * a seat or a clearance over its limit for no physical reason. Both ends of an edge are rounded
 * the same way, so rooms that shared a wall still share it. Idempotent.
 */
export function snapPlanToMm<P extends FloorPlan>(plan: P): P {
  const rect = (r: { x: number; y: number; w: number; h: number }) => {
    const x0 = mm(r.x);
    const y0 = mm(r.y);
    return {
      x: x0 / 1000,
      y: y0 / 1000,
      w: (mm(r.x + r.w) - x0) / 1000,
      h: (mm(r.y + r.h) - y0) / 1000,
    };
  };
  return {
    ...plan,
    shell: {
      ...plan.shell,
      w: grid(plan.shell.w),
      h: grid(plan.shell.h),
      ceilingM: grid(plan.shell.ceilingM),
    },
    rooms: plan.rooms.map((r) => ({
      ...r,
      rect: rect(r.rect),
      door: { ...r.door, x: grid(r.door.x), y: grid(r.door.y), widthM: grid(r.door.widthM) },
    })),
    circulation: plan.circulation.map((c) => ({ ...c, rect: rect(c.rect) })),
    entrance: {
      ...plan.entrance,
      x: grid(plan.entrance.x),
      y: grid(plan.entrance.y),
      widthM: grid(plan.entrance.widthM),
    },
  };
}
