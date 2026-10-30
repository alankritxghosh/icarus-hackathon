import { OPPOSITE } from "../catalog";
import type { Rect, Side } from "../geometry";
import { KNOWLEDGE } from "../knowledge";
import type { PlanRoom } from "../layout/types";
import { ASSETS } from "./catalog";
import {
  basinCounter,
  cubicle,
  downlight,
  fridge,
  island,
  linearLight,
  phoneBooth,
  receptionDesk,
  screen,
  serverRack,
} from "./parts";
import { type Item, Space } from "./place";

/** Positions are millimetre-grid values; a fit within this much counts as a fit. */
const FIT_TOLERANCE_M = 0.001;

export interface FurnishReport {
  /** Desks wanted and placed in the open workspace. */
  seatsWanted: number;
  seatsPlaced: number;
  privateDesksWanted: number;
  privateDesksPlaced: number;
  phoneBoothsWanted: number;
  phoneBoothsPlaced: number;
  meetingSeatsWanted: number;
  meetingSeatsPlaced: number;
}

/** A room seen along its long axis: u runs along it, v across, whatever the room's orientation. */
function frame(r: Rect) {
  const alongX = r.w >= r.h;
  return {
    U: alongX ? r.w : r.h,
    V: alongX ? r.h : r.w,
    xz: (u: number, v: number): [number, number] =>
      alongX ? [r.x + u, r.y + v] : [r.x + v, r.y + u],
    faceV: alongX ? 0 : Math.PI / 2,
    faceNegV: alongX ? Math.PI : (3 * Math.PI) / 2,
  };
}

const front = (rot: number): [number, number] => [Math.sin(rot), Math.cos(rot)];

const asset = (key: keyof typeof ASSETS, name: string, hangs = false, reserve = 0): Item => {
  const a = ASSETS[key];
  return { name, w: a.w, d: a.d, front: reserve, asset: { key, hangs } };
};

/** A scaled model standing in for a piece the planner sizes itself: a footprint and the stretch that fits the model to it. */
const scaled = (
  key: keyof typeof ASSETS,
  name: string,
  w: number,
  d: number,
  scale: [number, number, number],
  front = 0,
): Item => ({ name, w, d, front, asset: { key, scale } });

/** An office desk of the given width and the planner's usual depth, its kneehole open to +z. */
const desk = (width: number): Item => {
  const a = ASSETS.officeDesk;
  return scaled("officeDesk", "desk", width, 0.75, [width / a.w, 1, 0.75 / a.d]);
};
/** A swivel chair, facing +z, a little smaller than the lounge chair it comes from. */
const taskChair = (): Item => scaled("swivelChair", "chair", 0.7, 0.8, [0.7, 0.7, 0.7]);
/** A meeting table sized for its seats. */
const table = (width: number, depth: number): Item => {
  const a = ASSETS.meetingTable;
  return scaled("meetingTable", "table", width, depth, [width / a.w, 0.84, depth / a.d]);
};
/** A sofa of about the given width: the small model up to 2.1 m, the large one beyond. */
const sofa = (width: number): Item => {
  const key = width > 2.1 ? "sofaLarge" : "sofaSmall";
  const a = ASSETS[key];
  return scaled(key, "sofa", width, a.d, [width / a.w, 1, 1], 0.8);
};

/** A small thing standing on a desk or table, 0.79 m up. */
const onDesk = (key: keyof typeof ASSETS): Item => {
  const a = ASSETS[key];
  return { name: key, w: a.w, d: a.d, asset: { key, lift: 0.79 } };
};

const DESK_WIDTHS = KNOWLEDGE.workstation.deskWidthsM;
const CHAIR_OFFSET = 0.45;

/** Half the depth of a desk pair: desk 0.75 each, chairs reaching 0.73 beyond the fronts. */
const PAIR_DEPTH = KNOWLEDGE.workstation.deskDepthM;
const CHAIR_REACH = KNOWLEDGE.workstation.chairReachM;
const MODULE_PITCH = KNOWLEDGE.workstation.modulePitchM;

/**
 * Lay desk pairs for a chosen desk width, module count and desks per row, centred in the room, on
 * `space`. Returns how many seats were placed. Rows are spread over the free depth, not left in a corner.
 */
function layDesks(
  space: Space,
  width: number,
  modules: number,
  perRow: number,
  wanted: number,
  commit: boolean,
): number {
  const f = frame(space.rect);
  const chair = taskChair();
  const deskItem: Item = { ...desk(width), front: KNOWLEDGE.workstation.chairClearanceM };
  const block = (modules - 1) * MODULE_PITCH + PAIR_DEPTH + 2 * CHAIR_REACH;
  const free = Math.max(0, f.V - block);
  const extra = modules > 1 ? Math.min(free / (modules + 1), 1.2) : 0;
  const lead = (free - extra * (modules - 1)) / 2;
  const rowWidth = perRow * width + (perRow - 1) * 0.1;
  const u0 = (f.U - rowWidth) / 2 + width / 2;
  let placed = 0;
  for (let k = 0; k < modules && placed < wanted; k++) {
    const vA = lead + CHAIR_REACH + k * (MODULE_PITCH + extra);
    for (let i = 0; i < perRow && placed < wanted; i++) {
      const u = u0 + i * (width + 0.1);
      for (const [v, rot] of [
        [vA, f.faceNegV],
        [vA + PAIR_DEPTH, f.faceV],
      ] as const) {
        if (placed >= wanted) break;
        const [cx, cz] = f.xz(u, v);
        if (!space.place(deskItem, cx, cz, rot)) continue;
        const [fx, fz] = front(rot);
        space.placeTucked(chair, cx + fx * CHAIR_OFFSET, cz + fz * CHAIR_OFFSET, rot + Math.PI);
        // Pens, a notebook and a stapler on the desk, toward its back edge.
        space.force(onDesk("stationery"), cx - fx * 0.2, cz - fz * 0.2, rot);
        placed++;
      }
    }
    if (commit) {
      const [lx, lz] = f.xz(f.U / 2, vA + PAIR_DEPTH / 2);
      space.force(linearLight(Math.min(f.U - 1.2, rowWidth), space.ceilingM), lx, lz, f.faceV);
    }
  }
  return placed;
}

/** The fewest rows of the widest desks that seat everyone, found by trying them on a copy first. */
function placeDesks(space: Space, wanted: number): number {
  const f = frame(space.rect);
  // Fits are decided to the millimetre: a room a fraction of a millimetre short is not short.
  const maxModules = Math.max(
    0,
    Math.floor((f.V - 2 * CHAIR_REACH - PAIR_DEPTH + FIT_TOLERANCE_M) / MODULE_PITCH) + 1,
  );
  let fallback: { width: number; modules: number; perRow: number; placed: number } | undefined;
  for (const width of DESK_WIDTHS) {
    const maxPerRow = Math.floor((f.U - 1.2 + 0.1 + FIT_TOLERANCE_M) / (width + 0.1));
    for (let modules = 1; modules <= maxModules; modules++) {
      const base = Math.min(maxPerRow, Math.ceil(wanted / (2 * modules)));
      // A slot beside the door can be blocked, so try a spare desk or two per row.
      for (let perRow = base; perRow <= Math.min(maxPerRow, base + 2); perRow++) {
        const placed = layDesks(space.trial(), width, modules, perRow, wanted, false);
        if (placed >= wanted) return layDesks(space, width, modules, perRow, wanted, true);
        if (!fallback || placed > fallback.placed) fallback = { width, modules, perRow, placed };
      }
    }
  }
  if (!fallback || fallback.placed === 0) return 0;
  return layDesks(space, fallback.width, fallback.modules, fallback.perRow, wanted, true);
}

function plants(space: Space, count: number) {
  const r = space.rect;
  const corners: [number, number][] = [
    [r.x + 0.6, r.y + 0.6],
    [r.x + r.w - 0.6, r.y + 0.6],
    [r.x + 0.6, r.y + r.h - 0.6],
    [r.x + r.w - 0.6, r.y + r.h - 0.6],
  ];
  const kinds = [asset("plantTall", "plant"), asset("plantLow", "plant")];
  let placed = 0;
  for (const [i, [cx, cz]] of corners.entries()) {
    if (placed >= count) break;
    const plant = kinds[i % kinds.length] as Item;
    if (space.place(plant, cx, cz, 0)) placed++;
  }
}

function wallsByLength(space: Space, avoid: Side): Side[] {
  const sides: Side[] = ["north", "south", "east", "west"];
  return sides.filter((s) => s !== avoid).sort((a, b) => space.wallLength(b) - space.wallLength(a));
}

function openWorkspace(space: Space, seats: number, booths: number, report: FurnishReport) {
  let placedBooths = 0;
  const pod = phoneBooth();
  for (const side of wallsByLength(space, space.room.door.side)) {
    if (placedBooths >= booths) break;
    placedBooths += space.line(pod, side, { from: 0.8, gap: 0.3, max: booths - placedBooths });
  }
  report.phoneBoothsPlaced += placedBooths;
  report.seatsPlaced += placeDesks(space, seats);
  plants(space, 4);
}

function meetingRoom(space: Space, capacity: number, report: FurnishReport) {
  const f = frame(space.rect);
  const perSide = Math.ceil(capacity / 2);
  const length = Math.max(1.6, 0.62 * perSide + 0.5);
  const depth = capacity <= 4 ? 0.9 : 1.1;
  const t = { ...table(length, depth) };
  const [cx, cz] = f.xz(f.U / 2, f.V / 2);
  const tableRot = f.faceV;
  space.force(t, cx, cz, tableRot);
  const chair = asset("diningChair", "chair");
  let seats = 0;
  for (const [sign, rot] of [
    [-1, f.faceV],
    [1, f.faceNegV],
  ] as const) {
    for (let i = 0; i < perSide && seats < capacity; i++) {
      const u = f.U / 2 - ((perSide - 1) * 0.62) / 2 + i * 0.62;
      const [x, z] = f.xz(u, f.V / 2 + sign * (depth / 2 + 0.12));
      if (space.placeTucked(chair, x, z, rot)) seats++;
    }
  }
  report.meetingSeatsWanted += capacity;
  report.meetingSeatsPlaced += seats;
  const wall = OPPOSITE[space.room.door.side];
  const tv = screen();
  const p = space.againstWall(
    tv,
    wall,
    wall === "north" || wall === "south" ? space.rect.w / 2 : space.rect.h / 2,
  );
  space.place(tv, p.cx, p.cz, p.rotY);
  space.force(asset("pendant", "pendant", true), cx, cz, 0);
}

function kitchen(space: Space) {
  const cab = asset("cabinet", "counter", false, 0.9);
  let counters = 0;
  let counterSide: Side | undefined;
  for (const side of wallsByLength(space, space.room.door.side)) {
    counters = space.line(cab, side, { from: 0.1, gap: 0, max: 2 });
    if (counters > 0) {
      counterSide = side;
      break;
    }
  }
  if (counterSide)
    space.line(fridge(), counterSide, { from: counters * ASSETS.cabinet.w + 0.15, max: 1 });
  const f = frame(space.rect);
  const isl = island(Math.min(1.8, f.U - 2.4));
  if (f.U >= 3.2 && f.V >= 3.4) {
    const [cx, cz] = f.xz(f.U / 2, f.V / 2);
    if (space.place(isl, cx, cz, f.faceV)) {
      const stool = asset("barStool", "stool");
      for (const dx of [-0.5, 0, 0.5]) {
        const [sx, sz] = f.xz(f.U / 2 + dx, f.V / 2 + 0.85 / 2 + 0.3);
        space.force(stool, sx, sz, f.faceNegV);
      }
      space.force(asset("pendant", "pendant", true), cx, cz, 0);
    }
  }
}

function lounge(space: Space) {
  const f = frame(space.rect);
  const sofaLarge = sofa(2.4);
  const sofaMedium = sofa(1.8);
  let seated = false;
  for (const side of wallsByLength(space, space.room.door.side)) {
    const length = space.wallLength(side);
    for (const piece of [sofaLarge, sofaMedium]) {
      if (length < piece.w + 0.6) continue;
      const p = space.againstWall(piece, side, length / 2);
      if (space.place(piece, p.cx, p.cz, p.rotY)) {
        seated = true;
        break;
      }
    }
    if (seated) break;
  }
  const [cx, cz] = f.xz(f.U / 2, f.V / 2);
  const coffee = asset("coffeeTable", "coffee table");
  space.place(coffee, cx, cz, 0);
  space.place(asset("armchair", "armchair"), ...f.xz(f.U * 0.2, f.V * 0.72), f.faceNegV);
  space.place(asset("greenArmchair", "armchair"), ...f.xz(f.U * 0.8, f.V * 0.72), f.faceNegV);
  const [sx, sz] = f.xz(f.U * 0.2 + 0.9, f.V * 0.72);
  if (space.place(asset("sideTable", "side table"), sx, sz, 0))
    space.force({ ...asset("vase", "vase"), asset: { key: "vase", lift: 0.55 } }, sx, sz, 0);
  space.force(asset("pendant", "pendant", true), cx, cz, 0);
  plants(space, 3);
}

function reception(space: Space) {
  const wall = OPPOSITE[space.room.door.side];
  const length = space.wallLength(wall);
  const d = receptionDesk(Math.min(1.8, length - 0.6));
  const p = space.againstWall(d, wall, length / 2);
  space.place(d, p.cx, p.cz, p.rotY);
  const waiting = sofa(1.6);
  for (const side of (["north", "south", "east", "west"] as Side[]).filter(
    (s) => s !== wall && s !== space.room.door.side,
  )) {
    const q = space.againstWall(waiting, side, space.wallLength(side) * 0.5);
    if (space.place(waiting, q.cx, q.cz, q.rotY)) break;
  }
  plants(space, 2);
  const f = frame(space.rect);
  const [tx, tz] = f.xz(f.U * 0.5, f.V * 0.8);
  if (space.place(asset("sideTable", "side table"), tx, tz, 0))
    space.force({ ...asset("vase", "vase"), asset: { key: "vase", lift: 0.55 } }, tx, tz, 0);
  space.force(asset("pendant", "pendant", true), ...f.xz(f.U / 2, f.V / 2), 0);
}

function storage(space: Space) {
  const shelf = { ...asset("steelShelves", "shelving"), front: 0.7 };
  for (const side of wallsByLength(space, space.room.door.side))
    space.line(shelf, side, { from: 0.2, gap: 0.05 });
}

function serverRoom(space: Space) {
  const wall = OPPOSITE[space.room.door.side];
  space.line(serverRack(), wall, { from: 0.15, gap: 0.05 });
}

function restroom(space: Space) {
  for (const side of wallsByLength(space, space.room.door.side)) {
    if (space.line(cubicle(), side, { from: 0.2, gap: 0, max: 3 }) > 0) break;
  }
  for (const side of ["north", "south", "east", "west"] as Side[])
    if (space.line(basinCounter(0.9), side, { from: 0.1, max: 1 }) > 0) break;
}

function privateOffice(space: Space, report: FurnishReport) {
  const f = frame(space.rect);
  const d = { ...desk(1.4), front: KNOWLEDGE.workstation.chairClearanceM };
  const [cx, cz] = f.xz(f.U * 0.5, f.V * 0.28);
  if (space.place(d, cx, cz, f.faceV)) {
    report.privateDesksPlaced++;
    const [fx, fz] = front(f.faceV);
    space.force(taskChair(), cx + fx * CHAIR_OFFSET, cz + fz * CHAIR_OFFSET, f.faceV + Math.PI);
  }
  // A visitor's chair across the desk.
  const [gx, gz] = f.xz(f.U * 0.5, f.V * 0.72);
  space.place(asset("woodenChair", "chair"), gx, gz, f.faceNegV);
  for (const side of wallsByLength(space, space.room.door.side))
    if (
      space.line({ ...asset("bookcase", "bookcase"), front: 0.6 }, side, { from: 0.3, max: 1 }) > 0
    )
      break;
  plants(space, 1);
}

/** Recessed downlights on a grid, so every room has light that reads in a render. */
function downlights(space: Space) {
  const r = space.rect;
  const cols = Math.max(1, Math.round(r.w / 2.6));
  const rows = Math.max(1, Math.round(r.h / 2.6));
  const item = downlight(space.ceilingM);
  for (let i = 0; i < cols; i++)
    for (let j = 0; j < rows; j++)
      space.force(item, r.x + ((i + 0.5) * r.w) / cols, r.y + ((j + 0.5) * r.h) / rows, 0);
}

export function furnishRoom(
  room: PlanRoom,
  ceilingM: number,
  context: { seats: number; booths: number; capacity?: number },
  report: FurnishReport,
): Space {
  const space = new Space(room, ceilingM);
  switch (room.kind) {
    case "open_workspace":
      report.seatsWanted += context.seats;
      report.phoneBoothsWanted += context.booths;
      openWorkspace(space, context.seats, context.booths, report);
      break;
    case "meeting_room":
      meetingRoom(space, context.capacity ?? 6, report);
      break;
    case "kitchen":
      kitchen(space);
      break;
    case "lounge":
      lounge(space);
      break;
    case "reception":
      reception(space);
      break;
    case "storage":
      storage(space);
      break;
    case "server_room":
      serverRoom(space);
      break;
    case "restroom":
      restroom(space);
      break;
    case "private_office":
      privateOffice(space, report);
      break;
  }
  if (room.kind !== "open_workspace" && room.kind !== "meeting_room") downlights(space);
  return space;
}
