// Topological circulation: which spaces can be reached from the front door by doors, wall-less
// boundaries and stairs. It knows nothing about clear width; see the research notes for why that
// needs a second, geometric layer.
import { toRegion } from "./geometry";
import type { Kernel } from "./kernel";
import type { SpatialModel } from "./schema";
import { AREA_TOLERANCE_MM2 } from "./validate";

/**
 * Topological circulation: spaces are nodes; a door or passage in a wall joins the two spaces on
 * either side; connectors join levels. Reachability is measured from the entrance door.
 * This is the graph an egress or adjacency rule would use. It knows nothing about clear width.
 */
export function circulationGraph(m: SpatialModel, kernel: Kernel) {
  const adj = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const from = adj.get(a) ?? new Set<string>();
    const to = adj.get(b) ?? new Set<string>();
    from.add(b);
    to.add(a);
    adj.set(a, from);
    adj.set(b, to);
  };
  for (const s of m.spaces) adj.set(s.id, adj.get(s.id) ?? new Set());
  let entranceSpace: string | undefined;
  for (const w of m.walls)
    if (
      w.kind === "virtual" &&
      w.left &&
      w.right &&
      w.left !== "exterior" &&
      w.right !== "exterior"
    )
      link(w.left, w.right);
  for (const o of m.openings) {
    if (o.kind === "window") continue;
    const w = m.walls.find((x) => x.id === o.hostWallId);
    if (!w) continue;
    const sides = [w.left, w.right].filter((x): x is string => !!x && x !== "exterior");
    if (o.entrance && sides[0]) entranceSpace = sides[0];
    if (sides.length === 2) link(sides[0] as string, sides[1] as string);
  }
  // A connector joins whichever spaces contain its footprints.
  for (const c of m.connectors) {
    const inside = c.serves
      .map(
        (sv) =>
          m.spaces.find(
            (s) =>
              s.levelId === sv.levelId &&
              kernel.overlapArea(toRegion(s.boundary), toRegion(sv.footprint)) > AREA_TOLERANCE_MM2,
          )?.id,
      )
      .filter((x): x is string => !!x);
    for (let i = 1; i < inside.length; i++) link(inside[0] as string, inside[i] as string);
  }
  const seen = new Set<string>();
  const dist = new Map<string, number>();
  if (entranceSpace) {
    const q = [entranceSpace];
    dist.set(entranceSpace, 0);
    seen.add(entranceSpace);
    while (q.length) {
      const cur = q.shift() as string;
      for (const n of adj.get(cur) ?? [])
        if (!seen.has(n)) {
          seen.add(n);
          dist.set(n, (dist.get(cur) ?? 0) + 1);
          q.push(n);
        }
    }
  }
  return {
    entranceSpace,
    reachable: [...seen],
    unreachable: m.spaces.filter((s) => !seen.has(s.id)).map((s) => s.id),
    doorsFromEntrance: Object.fromEntries(dist),
  };
}
