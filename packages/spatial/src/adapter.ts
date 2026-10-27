// Converts between the layout engine's FloorPlan (axis-aligned rectangles in metres) and the spatial
// model (integer millimetres, walls and openings as entities).
//
// fromFloorPlan is lossless for everything a FloorPlan holds except the solver's own bookkeeping
// (search seed and rows, diagnostics), which the spatial model deliberately does not store.
// toFloorPlan goes back, and reports anything the spatial model holds that a FloorPlan cannot
// (curved walls, non-rectangular spaces, several levels) instead of silently dropping it.
import {
  type Circulation,
  openings as coreOpenings,
  type Diagnostic,
  expandRooms,
  type FloorPlan,
  type PlanRoom,
  type Program,
  type RoomKind,
  type Side,
} from "@icarus/core";
import { boundsOf, type Region, toRegion } from "./geometry";
import { GENERATED, SCHEMA_VERSION, type SpatialModel, type Vertex } from "./schema";

const mm = (m: number) => Math.round(m * 1000);
const EXTERIOR_MM = 250;
const INTERIOR_MM = 100;
const VIRTUAL_MM = 20;
const LEVEL = "L0";

export const OFFICE = "office.";
export const CIRCULATION = "circulation.";

interface RectSpace {
  id: string;
  kind: string;
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  capacity?: number;
  targetAreaM2?: number;
  locked: boolean;
}

type Atom = { o: "h" | "v"; c: number; a: number; b: number; left?: string; right?: string };
type WallRec = SpatialModel["walls"][number];

const ring = (s: RectSpace): Vertex[] => [
  { x: s.x0, y: s.y0 },
  { x: s.x1, y: s.y0 },
  { x: s.x1, y: s.y1 },
  { x: s.x0, y: s.y1 },
];

const lengthOf = (w: WallRec) => Math.abs(w.b.x - w.a.x) + Math.abs(w.b.y - w.a.y);
const horizontal = (w: WallRec) => w.a.y === w.b.y;

/** Walls from the edges of axis-aligned spaces: every shared edge becomes one wall, split where neighbours change. */
function wallsFrom(spaces: RectSpace[], W: number, H: number, glazedSides: Side[]): WallRec[] {
  type Edge = {
    o: "h" | "v";
    c: number;
    a: number;
    b: number;
    space: string;
    side: "left" | "right";
  };
  const edges: Edge[] = [];
  for (const s of spaces) {
    // Left of a wall walking +x is +y (the space below); left walking +y is -x (the space to the west).
    edges.push({ o: "h", c: s.y0, a: s.x0, b: s.x1, space: s.id, side: "left" });
    edges.push({ o: "h", c: s.y1, a: s.x0, b: s.x1, space: s.id, side: "right" });
    edges.push({ o: "v", c: s.x1, a: s.y0, b: s.y1, space: s.id, side: "left" });
    edges.push({ o: "v", c: s.x0, a: s.y0, b: s.y1, space: s.id, side: "right" });
  }
  const lines = new Map<string, Edge[]>();
  for (const e of edges) lines.set(`${e.o}:${e.c}`, [...(lines.get(`${e.o}:${e.c}`) ?? []), e]);
  const atoms: Atom[] = [];
  for (const [key, list] of lines) {
    const [o, cs] = key.split(":") as ["h" | "v", string];
    const cuts = [...new Set(list.flatMap((e) => [e.a, e.b]))].sort((p, q) => p - q);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i] as number;
      const b = cuts[i + 1] as number;
      const atom: Atom = { o, c: Number(cs), a, b };
      for (const e of list) if (e.a <= a && e.b >= b) atom[e.side] = e.space;
      if (atom.left || atom.right) atoms.push(atom);
    }
  }
  const onShell = (at: Atom) =>
    at.o === "h" ? at.c === 0 || at.c === H : at.c === 0 || at.c === W;
  for (const at of atoms)
    if (onShell(at)) {
      if (!at.left) at.left = "exterior";
      if (!at.right) at.right = "exterior";
    }
  atoms.sort((p, q) => (p.o + p.c).localeCompare(q.o + q.c) || p.a - q.a);
  const merged: Atom[] = [];
  for (const at of atoms) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.o === at.o &&
      last.c === at.c &&
      last.b === at.a &&
      last.left === at.left &&
      last.right === at.right
    )
      last.b = at.b;
    else merged.push({ ...at });
  }
  const circ = (id?: string) =>
    !!id && !!spaces.find((s) => s.id === id)?.kind.startsWith(CIRCULATION);
  return merged.map((at) => {
    const exterior = at.left === "exterior" || at.right === "exterior";
    const side: Side | undefined = !exterior
      ? undefined
      : at.o === "h"
        ? at.c === 0
          ? "north"
          : "south"
        : at.c === 0
          ? "west"
          : "east";
    const virtual = circ(at.left) && circ(at.right);
    return {
      id: `wall.${at.o}${at.c}.${at.a}-${at.b}`,
      levelId: LEVEL,
      a: at.o === "h" ? { x: at.a, y: at.c } : { x: at.c, y: at.a },
      b: at.o === "h" ? { x: at.b, y: at.c } : { x: at.c, y: at.b },
      thicknessMm: virtual ? VIRTUAL_MM : exterior ? EXTERIOR_MM : INTERIOR_MM,
      kind: virtual
        ? ("virtual" as const)
        : exterior
          ? ("exterior" as const)
          : ("interior" as const),
      // Nothing here has been engineered: exterior structure is unknown, partitions are ours.
      structural: exterior ? ("unknown" as const) : ("non_structural" as const),
      glazed: !!side && glazedSides.includes(side),
      left: at.left,
      right: at.right,
      provenance: GENERATED,
    };
  });
}

export function fromFloorPlan(
  plan: FloorPlan,
  options: { program?: Program; name?: string } = {},
): SpatialModel {
  const W = mm(plan.shell.w);
  const H = mm(plan.shell.h);
  const planned = new Map(
    (options.program ? expandRooms(options.program) : []).map((r) => [r.id, r]),
  );
  const locked = new Set((options.program?.locks ?? []).map((l) => l.id));
  const spaces: RectSpace[] = [
    ...plan.rooms.map((r) => ({
      id: r.id,
      kind: `${OFFICE}${r.kind}`,
      name: r.name,
      x0: mm(r.rect.x),
      y0: mm(r.rect.y),
      x1: mm(r.rect.x + r.rect.w),
      y1: mm(r.rect.y + r.rect.h),
      capacity: planned.get(r.id)?.capacity,
      targetAreaM2: r.targetAreaM2,
      locked: locked.has(r.id),
    })),
    ...plan.circulation.map((c) => ({
      id: c.id,
      kind: `${CIRCULATION}${c.kind}`,
      name: c.kind === "lobby" ? "Entrance lobby" : "Corridor",
      x0: mm(c.rect.x),
      y0: mm(c.rect.y),
      x1: mm(c.rect.x + c.rect.w),
      y1: mm(c.rect.y + c.rect.h),
      locked: false,
    })),
  ];
  const walls = wallsFrom(spaces, W, H, plan.shell.windows);
  const openings: SpatialModel["openings"] = [];

  const hostFor = (
    axis: "h" | "v",
    at: number,
    centre: number,
    sideSpace: (w: WallRec) => boolean,
  ) =>
    walls.find((w) => {
      const sameLine =
        axis === "h" ? w.a.y === w.b.y && w.a.y === at : w.a.x === w.b.x && w.a.x === at;
      if (!sameLine) return false;
      const lo = axis === "h" ? w.a.x : w.a.y;
      const hi = axis === "h" ? w.b.x : w.b.y;
      return centre >= lo && centre <= hi && sideSpace(w);
    });
  const put = (
    id: string,
    w: WallRec,
    centre: number,
    widthMm: number,
    kind: "door" | "window",
    extra: { sillMm?: number; headMm?: number; entrance?: boolean } = {},
  ) => {
    const start = Math.max(
      0,
      Math.min(
        lengthOf(w) - widthMm,
        Math.round(centre - widthMm / 2 - (horizontal(w) ? w.a.x : w.a.y)),
      ),
    );
    openings.push({
      id,
      hostWallId: w.id,
      kind,
      offsetMm: start,
      widthMm,
      sillMm: extra.sillMm ?? 0,
      headMm: extra.headMm ?? 2100,
      entrance: extra.entrance ?? false,
      provenance: GENERATED,
    });
  };

  for (const room of plan.rooms) {
    const d = room.door;
    const h = d.side === "north" || d.side === "south";
    const at = mm(h ? d.y : d.x);
    const centre = mm(h ? d.x : d.y);
    const host = hostFor(
      h ? "h" : "v",
      at,
      centre,
      (w) =>
        (w.left === room.id || w.right === room.id) &&
        (w.left === d.opensTo || w.right === d.opensTo),
    );
    if (host) put(`door.${room.id}`, host, centre, mm(d.widthM), "door");
  }
  const e = plan.entrance;
  const eh = e.side === "north" || e.side === "south";
  const eAt = mm(
    eh ? (e.side === "north" ? 0 : plan.shell.h) : e.side === "west" ? 0 : plan.shell.w,
  );
  const eCentre = mm(eh ? e.x : e.y);
  const front = hostFor(
    eh ? "h" : "v",
    eAt,
    eCentre,
    (w) => w.left === "exterior" || w.right === "exterior",
  );
  if (front)
    put("door.entrance", front, eCentre, mm(e.widthM), "door", { headMm: 2200, entrance: true });

  const count = new Map<string, number>();
  for (const o of coreOpenings(plan)) {
    if (o.opening.kind !== "window" || !o.opening.roomId) continue;
    const roomId = o.opening.roomId;
    const host = hostFor(
      o.axis,
      mm(o.at),
      mm(o.opening.center),
      (w) =>
        (w.left === roomId || w.right === roomId) &&
        (w.left === "exterior" || w.right === "exterior"),
    );
    if (!host) continue;
    const n = (count.get(roomId) ?? 0) + 1;
    count.set(roomId, n);
    put(`window.${roomId}.${n}`, host, mm(o.opening.center), mm(o.opening.width), "window", {
      sillMm: mm(o.opening.sill),
      headMm: mm(o.opening.head),
    });
  }

  return {
    schema: SCHEMA_VERSION,
    units: "mm",
    name: options.name ?? "Office",
    northDeg: 0,
    levels: [
      {
        id: LEVEL,
        name: "Level 0",
        elevationMm: 0,
        heightMm: mm(plan.shell.ceilingM),
        boundary: {
          outer: [
            { x: 0, y: 0 },
            { x: W, y: 0 },
            { x: W, y: H },
            { x: 0, y: H },
          ],
          holes: [],
        },
        provenance: GENERATED,
      },
    ],
    spaces: spaces.map((s) => ({
      id: s.id,
      levelId: LEVEL,
      kind: s.kind,
      name: s.name,
      boundary: { outer: ring(s), holes: [] },
      programme: { capacity: s.capacity, targetAreaM2: s.targetAreaM2 },
      locked: s.locked,
      provenance: GENERATED,
    })),
    walls,
    openings,
    obstacles: [],
    connectors: [],
    items: [],
  };
}

export interface BackConversion {
  plan: FloorPlan;
  /** Things in the model that a FloorPlan cannot hold. Empty means the plan is a faithful view. */
  unsupported: string[];
}

/**
 * A FloorPlan view of a spatial model. `extras` carries the solver bookkeeping the model does not
 * store; without it the plan has an empty search record and no diagnostics.
 */
export function toFloorPlan(
  model: SpatialModel,
  extras: { search?: FloorPlan["search"]; diagnostics?: Diagnostic[] } = {},
): BackConversion {
  const unsupported: string[] = [];
  if (model.levels.length !== 1) unsupported.push(`${model.levels.length} levels (a plan has one)`);
  const level = model.levels[0];
  if (!level) throw new Error("a spatial model needs a level");
  if (model.connectors.length) unsupported.push("stairs or lifts");
  if (model.obstacles.length) unsupported.push("columns, cores or other obstacles");
  if (model.items.length) unsupported.push("placed items");
  if (level.boundary.holes.length || level.boundary.outer.length !== 4)
    unsupported.push("a level outline that is not a rectangle");
  const b = boundsOf(toRegion(level.boundary));
  const W = b.x1 - b.x0;
  const H = b.y1 - b.y0;

  const rectOf = (
    s: SpatialModel["spaces"][number],
  ): { x: number; y: number; w: number; h: number } | undefined => {
    const r: Region = toRegion(s.boundary);
    const bb = boundsOf(r);
    const poly = s.boundary.outer;
    const rectangular =
      poly.length === 4 &&
      !s.boundary.holes.length &&
      poly.every((v) => !v.bulge) &&
      (bb.x1 - bb.x0) * (bb.y1 - bb.y0) === Math.abs(areaOf(poly));
    if (!rectangular) {
      unsupported.push(`space ${s.id} is not a rectangle`);
      return undefined;
    }
    return {
      x: bb.x0 / 1000,
      y: bb.y0 / 1000,
      w: (bb.x1 - bb.x0) / 1000,
      h: (bb.y1 - bb.y0) / 1000,
    };
  };

  const wallById = new Map(model.walls.map((w) => [w.id, w]));
  if (model.walls.some((w) => w.bulge)) unsupported.push("curved walls");

  const sideOf = (w: WallRec): Side | undefined => {
    if (horizontal(w)) return w.a.y === b.y0 ? "north" : w.a.y === b.y1 ? "south" : undefined;
    return w.a.x === b.x0 ? "west" : w.a.x === b.x1 ? "east" : undefined;
  };

  const rooms: PlanRoom[] = [];
  const circulation: Circulation[] = [];
  for (const s of model.spaces) {
    const rect = rectOf(s);
    if (!rect) continue;
    if (s.kind.startsWith(CIRCULATION)) {
      circulation.push({
        id: s.id,
        kind: s.kind.slice(CIRCULATION.length) === "lobby" ? "lobby" : "corridor",
        rect,
      });
      continue;
    }
    const door = model.openings.find((o) => {
      if (o.kind !== "door" || o.entrance) return false;
      const w = wallById.get(o.hostWallId);
      return !!w && (w.left === s.id || w.right === s.id);
    });
    const host = door ? wallById.get(door.hostWallId) : undefined;
    if (!door || !host) {
      unsupported.push(`space ${s.id} has no door`);
      continue;
    }
    const centre = (horizontal(host) ? host.a.x : host.a.y) + door.offsetMm + door.widthMm / 2;
    const doorSide = rectSide(host, rect);
    rooms.push({
      id: s.id,
      kind: s.kind.slice(OFFICE.length) as RoomKind,
      name: s.name,
      rect,
      targetAreaM2: s.programme.targetAreaM2 ?? rect.w * rect.h,
      door: {
        side: doorSide,
        x: (horizontal(host) ? centre : host.a.x) / 1000,
        y: (horizontal(host) ? host.a.y : centre) / 1000,
        widthM: door.widthMm / 1000,
        opensTo: (host.left === s.id ? host.right : host.left) ?? "",
      },
    });
  }

  const front = model.openings.find((o) => o.entrance);
  const frontWall = front ? wallById.get(front.hostWallId) : undefined;
  if (!front || !frontWall) throw new Error("the model has no entrance door");
  const fcentre =
    (horizontal(frontWall) ? frontWall.a.x : frontWall.a.y) + front.offsetMm + front.widthMm / 2;
  const entranceSide = sideOf(frontWall);
  if (!entranceSide) throw new Error("the entrance door is not on an outer wall");

  const windowSides = new Set<Side>();
  for (const w of model.walls) {
    const side = w.glazed ? sideOf(w) : undefined;
    if (side) windowSides.add(side);
  }
  for (const o of model.openings) {
    if (o.kind !== "window") continue;
    const w = wallById.get(o.hostWallId);
    const side = w ? sideOf(w) : undefined;
    if (side) windowSides.add(side);
  }

  return {
    unsupported,
    plan: {
      shell: {
        w: W / 1000,
        h: H / 1000,
        ceilingM: level.heightMm / 1000,
        windows: (["north", "south", "east", "west"] as const).filter((s) => windowSides.has(s)),
        entrance: entranceSide,
      },
      rooms,
      circulation,
      entrance: {
        side: entranceSide,
        x: (horizontal(frontWall) ? fcentre : frontWall.a.x) / 1000,
        y: (horizontal(frontWall) ? frontWall.a.y : fcentre) / 1000,
        widthM: front.widthMm / 1000,
      },
      diagnostics: extras.diagnostics ?? [],
      search: extras.search ?? { seed: 0, rows: [], cost: 0 },
    },
  };
}

function areaOf(poly: Vertex[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i] as Vertex;
    const q = poly[(i + 1) % poly.length] as Vertex;
    s += p.x * q.y - q.x * p.y;
  }
  return s / 2;
}

function rectSide(host: WallRec, rect: { x: number; y: number; w: number; h: number }): Side {
  if (horizontal(host)) return host.a.y / 1000 === rect.y ? "north" : "south";
  return host.a.x / 1000 === rect.x ? "west" : "east";
}
