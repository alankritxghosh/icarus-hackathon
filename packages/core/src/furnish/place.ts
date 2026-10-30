import type { SceneNode } from "../build/scene";
import { overlapArea, type Rect, type Side } from "../geometry";
import { KNOWLEDGE } from "../knowledge";
import type { PlanRoom } from "../layout/types";
import { ASSETS, type AssetKey } from "./catalog";

/** A box in an object's own frame: offset of its centre from the footprint centre on the floor. */
export interface Part {
  name: string;
  size: [number, number, number];
  at: [number, number, number];
  material: string;
  type?: SceneNode["type"];
  cylinder?: boolean;
}

/** Anything placed in a room: a footprint to reserve and the nodes it is made of. */
export interface Item {
  name: string;
  /** Footprint (x by z) before rotation. */
  w: number;
  d: number;
  parts?: Part[];
  /** `scale` stretches the model (x, y, z in its own frame) to fit a footprint; the node records it so the viewer applies it. */
  asset?: { key: AssetKey; hangs?: boolean; scale?: [number, number, number]; lift?: number };
  /** Extra free space in front, reserved so nothing blocks it. */
  front?: number;
}

const WALL_GAP = 0.03;

/** Footprint rectangle of an item centred at (cx, cz) turned by a quarter-turn multiple. */
export function footprint(item: Item, cx: number, cz: number, rotY: number): Rect {
  const turned = Math.abs(Math.sin(rotY)) > 0.5;
  const w = turned ? item.d : item.w;
  const d = turned ? item.w : item.d;
  return { x: cx - w / 2, y: cz - d / 2, w, h: d };
}

/** The reserved space in front of an item (its footprint plus the free space it needs). */
function reserved(item: Item, cx: number, cz: number, rotY: number): Rect {
  const base = footprint(item, cx, cz, rotY);
  const f = item.front ?? 0;
  if (f <= 0) return base;
  const dirX = Math.round(Math.sin(rotY));
  const dirZ = Math.round(Math.cos(rotY));
  return {
    x: dirX < 0 ? base.x - f : base.x,
    y: dirZ < 0 ? base.y - f : base.y,
    w: base.w + (dirX !== 0 ? f : 0),
    h: base.h + (dirZ !== 0 ? f : 0),
  };
}

const inside = (outer: Rect, r: Rect) =>
  r.x >= outer.x - 1e-6 &&
  r.y >= outer.y - 1e-6 &&
  r.x + r.w <= outer.x + outer.w + 1e-6 &&
  r.y + r.h <= outer.y + outer.h + 1e-6;

/** What a room still has free, and the nodes placed so far. */
export class Space {
  readonly nodes: SceneNode[] = [];
  readonly taken: Rect[] = [];
  readonly footprints: Rect[] = [];
  /** Footprints of items that were checked against the room and each other (not forced ones). */
  readonly checked: Rect[] = [];
  private count = 0;

  constructor(
    readonly room: PlanRoom,
    readonly ceilingM: number,
  ) {
    this.taken.push(doorClearance(room));
  }

  /** A copy with the same room and the same reserved space, for trying a layout before committing it. */
  trial(): Space {
    const copy = new Space(this.room, this.ceilingM);
    copy.taken.length = 0;
    copy.taken.push(...this.taken);
    return copy;
  }

  get rect(): Rect {
    return this.room.rect;
  }

  /** True when the item fits inside the room, clear of everything placed and of the door. */
  fits(item: Item, cx: number, cz: number, rotY: number): boolean {
    const area = reserved(item, cx, cz, rotY);
    const own = footprint(item, cx, cz, rotY);
    // Only the object itself must be inside the room; the free space it reserves may run to a wall.
    return inside(this.rect, own) && !this.taken.some((t) => overlapArea(t, area) > 1e-4);
  }

  /** True when the object's footprint lies inside the room, whatever else is there (a chair tucked under a table). */
  contains(item: Item, cx: number, cz: number, rotY: number): boolean {
    return inside(this.rect, footprint(item, cx, cz, rotY));
  }

  /** Place an object that may overlap reserved space, but only if it stays inside the room. */
  placeTucked(item: Item, cx: number, cz: number, rotY: number): boolean {
    if (!this.contains(item, cx, cz, rotY)) return false;
    this.force(item, cx, cz, rotY);
    return true;
  }

  place(item: Item, cx: number, cz: number, rotY: number): boolean {
    if (!this.fits(item, cx, cz, rotY)) return false;
    this.checked.push(footprint(item, cx, cz, rotY));
    this.force(item, cx, cz, rotY);
    return true;
  }

  /** Place without checking, for items that deliberately overlap reserved space (on a desk, say). */
  force(item: Item, cx: number, cz: number, rotY: number) {
    const own = footprint(item, cx, cz, rotY);
    this.taken.push(reserved(item, cx, cz, rotY));
    this.footprints.push(own);
    const n = ++this.count;
    const base = `${this.room.id}.${item.name}.${n}`;
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const rotated = (x: number, z: number): [number, number] => [
      cx + x * cos + z * sin,
      cz - x * sin + z * cos,
    ];
    if (item.asset) {
      const spec = ASSETS[item.asset.key];
      this.nodes.push({
        id: base,
        name: item.name,
        type: item.asset.hangs ? "light" : "furniture",
        roomId: this.room.id,
        roomKind: this.room.kind,
        geometry: {
          kind: "asset",
          id: spec.id,
          size: [
            spec.w * (item.asset.scale?.[0] ?? 1),
            spec.h * (item.asset.scale?.[1] ?? 1),
            spec.d * (item.asset.scale?.[2] ?? 1),
          ],
          ...(item.asset.scale ? { scale: item.asset.scale } : {}),
        },
        position: [
          cx,
          item.asset.hangs ? this.ceilingM - spec.h * (item.asset.scale?.[1] ?? 1) : 0,
          cz,
        ],
        rotationY: rotY + (spec.yaw ?? 0),
        material: "oak",
        tags: ["furniture", item.name],
      });
    }
    for (const [i, part] of (item.parts ?? []).entries()) {
      const [x, z] = rotated(part.at[0], part.at[2]);
      this.nodes.push({
        id: `${base}.${i}`,
        name: `${item.name} ${part.name}`,
        type: part.type ?? "furniture",
        roomId: this.room.id,
        roomKind: this.room.kind,
        geometry: part.cylinder
          ? { kind: "cylinder", radius: part.size[0] / 2, height: part.size[1] }
          : { kind: "box", size: part.size },
        position: [x, part.at[1], z],
        rotationY: rotY,
        material: part.material,
        tags: ["furniture", item.name],
      });
    }
  }

  /** Rotation for an item whose back is against `side`, facing into the room. */
  static facing(side: Side): number {
    return { north: 0, south: Math.PI, west: Math.PI / 2, east: -Math.PI / 2 }[side];
  }

  /**
   * Centre of an item pushed against `side`, at distance `along` (metres from the wall's start,
   * the north or west end) to the item's centre.
   */
  againstWall(item: Item, side: Side, along: number): { cx: number; cz: number; rotY: number } {
    const r = this.rect;
    const rotY = Space.facing(side);
    const d = item.d;
    if (side === "north") return { cx: r.x + along, cz: r.y + d / 2 + WALL_GAP, rotY };
    if (side === "south") return { cx: r.x + along, cz: r.y + r.h - d / 2 - WALL_GAP, rotY };
    if (side === "west") return { cx: r.x + d / 2 + WALL_GAP, cz: r.y + along, rotY };
    return { cx: r.x + r.w - d / 2 - WALL_GAP, cz: r.y + along, rotY };
  }

  /** Length of the given wall of the room. */
  wallLength(side: Side): number {
    return side === "north" || side === "south" ? this.rect.w : this.rect.h;
  }

  /** Fill a wall with as many of an item as fit, spaced by `gap`, starting `from` metres in. */
  line(item: Item, side: Side, opts: { from?: number; gap?: number; max?: number } = {}): number {
    const gap = opts.gap ?? 0.1;
    const max = opts.max ?? 99;
    const length = this.wallLength(side);
    let along = (opts.from ?? 0) + item.w / 2;
    let placed = 0;
    while (placed < max && along + item.w / 2 <= length + 1e-6) {
      const p = this.againstWall(item, side, along);
      if (this.place(item, p.cx, p.cz, p.rotY)) {
        placed++;
        along += item.w + gap;
      } else along += 0.15;
    }
    return placed;
  }
}

/** Space in front of the room's door, kept free so it can be reached and opened. */
export function doorClearance(room: PlanRoom): Rect {
  const { door, rect } = room;
  const span = door.widthM + 0.3;
  const depth = KNOWLEDGE.circulation.doorClearanceM;
  if (door.side === "north") return { x: door.x - span / 2, y: rect.y, w: span, h: depth };
  if (door.side === "south")
    return { x: door.x - span / 2, y: rect.y + rect.h - depth, w: span, h: depth };
  if (door.side === "west") return { x: rect.x, y: door.y - span / 2, w: depth, h: span };
  return { x: rect.x + rect.w - depth, y: door.y - span / 2, w: depth, h: span };
}
