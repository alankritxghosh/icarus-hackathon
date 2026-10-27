import type { FloorPlan } from "@icarus/core";

// Position and size are rounded to millimetres separately, so a side can move by up to one.
const MM = 0.00101;

/** Differences between two plans beyond a millimetre of rounding; empty means the same plan. */
export function samePlan(a: FloorPlan, b: FloorPlan, tolerance = MM): string[] {
  const diffs: string[] = [];
  const near = (x: number, y: number, what: string) => {
    if (Math.abs(x - y) > tolerance) diffs.push(`${what}: ${x} vs ${y}`);
  };
  near(a.shell.w, b.shell.w, "shell.w");
  near(a.shell.h, b.shell.h, "shell.h");
  near(a.shell.ceilingM, b.shell.ceilingM, "ceiling");
  if (a.shell.entrance !== b.shell.entrance) diffs.push("shell.entrance");
  if ([...a.shell.windows].sort().join() !== [...b.shell.windows].sort().join())
    diffs.push(`windows ${a.shell.windows} vs ${b.shell.windows}`);
  near(a.entrance.x, b.entrance.x, "entrance.x");
  near(a.entrance.y, b.entrance.y, "entrance.y");
  near(a.entrance.widthM, b.entrance.widthM, "entrance.width");
  if (a.rooms.length !== b.rooms.length) diffs.push("room count");
  for (const [i, r] of a.rooms.entries()) {
    const o = b.rooms[i];
    if (!o) {
      diffs.push(`room ${r.id} missing`);
      continue;
    }
    if (r.id !== o.id || r.kind !== o.kind || r.name !== o.name)
      diffs.push(`room ${r.id} identity`);
    for (const f of ["x", "y", "w", "h"] as const) near(r.rect[f], o.rect[f], `${r.id}.rect.${f}`);
    near(r.targetAreaM2, o.targetAreaM2, `${r.id}.target`);
    if (r.door.side !== o.door.side) diffs.push(`${r.id} door side`);
    if (r.door.opensTo !== o.door.opensTo) diffs.push(`${r.id} door opensTo`);
    near(r.door.x, o.door.x, `${r.id}.door.x`);
    near(r.door.y, o.door.y, `${r.id}.door.y`);
    near(r.door.widthM, o.door.widthM, `${r.id}.door.width`);
  }
  if (a.circulation.length !== b.circulation.length) diffs.push("circulation count");
  for (const [i, c] of a.circulation.entries()) {
    const o = b.circulation[i];
    if (!o || o.id !== c.id || o.kind !== c.kind) {
      diffs.push(`circulation ${c.id}`);
      continue;
    }
    for (const f of ["x", "y", "w", "h"] as const) near(c.rect[f], o.rect[f], `${c.id}.rect.${f}`);
  }
  return diffs;
}
