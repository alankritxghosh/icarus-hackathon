import { OPPOSITE } from "../catalog";
import type { Rect, Side } from "../geometry";
import type { PlanRoom } from "../layout/types";
import { ASSETS } from "./catalog";
import {
  basinCounter,
  cubicle,
  desk,
  downlight,
  fridge,
  island,
  linearLight,
  phoneBooth,
  receptionDesk,
  screen,
  serverRack,
  table,
  taskChair,
} from "./parts";
import { type Item, Space } from "./place";

export interface FurnishReport {
  /** Desks wanted and placed in the open workspace. */
  seatsWanted: number;
  seatsPlaced: number;
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

const DESK_WIDTHS = [1.6, 1.4, 1.2];
const CHAIR_OFFSET = 0.45;

/** Back-to-back desk pairs in rows along the long axis, with a task chair at each desk. */
function placeDesks(space: Space, wanted: number): number {
  const f = frame(space.rect);
  const chair = taskChair();
  let chosen = DESK_WIDTHS[DESK_WIDTHS.length - 1] ?? 1.2;
  for (const width of DESK_WIDTHS) {
    const perRow = Math.floor((f.U - 1.2 + 0.1) / (width + 0.1));
    const modules = Math.floor((f.V - 1.63 - 0.88) / 3.3) + 1;
    const capacity = Math.max(0, perRow) * 2 * Math.max(0, modules);
    chosen = width;
    if (capacity >= wanted) break;
  }
  const deskItem: Item = { ...desk(chosen), front: 0.9 };
  let placed = 0;
  for (let k = 0; placed < wanted; k++) {
    const vA = 0.88 + k * 3.3;
    if (vA > f.V - 1.63 + 1e-6) break;
    const before = placed;
    for (let i = 0; placed < wanted; i++) {
      const u = 0.6 + chosen / 2 + i * (chosen + 0.1);
      if (u + chosen / 2 > f.U - 0.6 + 1e-6) break;
      for (const [v, rot] of [
        [vA, f.faceNegV],
        [vA + 0.75, f.faceV],
      ] as const) {
        if (placed >= wanted) break;
        const [cx, cz] = f.xz(u, v);
        if (!space.place(deskItem, cx, cz, rot)) continue;
        const [fx, fz] = front(rot);
        space.placeTucked(chair, cx + fx * CHAIR_OFFSET, cz + fz * CHAIR_OFFSET, rot + Math.PI);
        placed++;
      }
    }
    if (placed > before) {
      const [lx, lz] = f.xz(f.U / 2, vA + 0.375);
      const length = Math.min(f.U - 1.2, 6);
      space.force(linearLight(length, space.ceilingM), lx, lz, f.faceV);
    }
  }
  return placed;
}

function plants(space: Space, count: number) {
  const r = space.rect;
  const corners: [number, number][] = [
    [r.x + 0.6, r.y + 0.6],
    [r.x + r.w - 0.6, r.y + 0.6],
    [r.x + 0.6, r.y + r.h - 0.6],
    [r.x + r.w - 0.6, r.y + r.h - 0.6],
  ];
  const kinds = [asset("tree", "tree"), asset("plantTall", "plant"), asset("plantLow", "plant")];
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
  const sofa = asset("sofaLarge", "sofa");
  const sofaMedium = asset("sofaMedium", "sofa");
  let seated = false;
  for (const side of wallsByLength(space, space.room.door.side)) {
    const length = space.wallLength(side);
    for (const piece of [sofa, sofaMedium]) {
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
  space.place(asset("loungeChair", "lounge chair"), ...f.xz(f.U * 0.2, f.V * 0.72), f.faceNegV);
  space.force(asset("pendant", "pendant", true), cx, cz, 0);
  plants(space, 3);
}

function reception(space: Space) {
  const wall = OPPOSITE[space.room.door.side];
  const length = space.wallLength(wall);
  const d = receptionDesk(Math.min(1.8, length - 0.6));
  const p = space.againstWall(d, wall, length / 2);
  space.place(d, p.cx, p.cz, p.rotY);
  const sofa = asset("sofaSmall", "waiting sofa");
  for (const side of (["north", "south", "east", "west"] as Side[]).filter(
    (s) => s !== wall && s !== space.room.door.side,
  )) {
    const q = space.againstWall(sofa, side, space.wallLength(side) * 0.5);
    if (space.place(sofa, q.cx, q.cz, q.rotY)) break;
  }
  plants(space, 2);
  const f = frame(space.rect);
  space.force(asset("pendant", "pendant", true), ...f.xz(f.U / 2, f.V / 2), 0);
}

function storage(space: Space) {
  const shelf = { ...asset("shelves", "shelving"), front: 0.7 };
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

function privateOffice(space: Space) {
  const f = frame(space.rect);
  const d = { ...desk(1.4), front: 0.9 };
  const [cx, cz] = f.xz(f.U * 0.5, f.V * 0.28);
  if (space.place(d, cx, cz, f.faceV)) {
    const [fx, fz] = front(f.faceV);
    space.force(taskChair(), cx + fx * CHAIR_OFFSET, cz + fz * CHAIR_OFFSET, f.faceV + Math.PI);
  }
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
      privateOffice(space);
      break;
  }
  if (room.kind !== "open_workspace" && room.kind !== "meeting_room") downlights(space);
  return space;
}
