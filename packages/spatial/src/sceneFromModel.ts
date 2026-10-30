// Builds a 3D scene (the shape list the viewer draws and exports) from a spatial model: walls with their doors and
// windows cut through, a floor, a ceiling and ceiling lights. It draws what the model holds and nothing more: no
// furniture is invented for a model that has none. Floors inside the building are always tile or wood.
import { ASSETS, MATERIALS, type Scene, type SceneNode, type Viewpoint } from "@icarus/core";
import type { SpatialModel } from "./schema";

const M = 1 / 1000;
const WINDOW_SILL = 0.9;
const WINDOW_HEAD = 2.1;
const DOOR_HEAD = 2.1;

export interface DrawnScene {
  scene: Scene;
  /** Room names at their centres, in scene metres, for the plan view. */
  labels: { name: string; x: number; y: number }[];
  viewpoints: Viewpoint[];
  /** Rooms that were furnished, by name, so the person can be told what Icarus added. */
  furnished: string[];
}

type Ring = { x: number; y: number }[];

/** A rectilinear ring as rectangles, by horizontal strips; any other ring becomes its bounding box. */
function rectangles(ring: Ring): [number, number, number, number][] {
  const rectilinear = ring.every((p, i) => {
    const q = ring[(i + 1) % ring.length] as { x: number; y: number };
    return p.x === q.x || p.y === q.y;
  });
  const xs = ring.map((p) => p.x);
  const ys = ring.map((p) => p.y);
  const box: [number, number, number, number] = [
    Math.min(...xs),
    Math.min(...ys),
    Math.max(...xs),
    Math.max(...ys),
  ];
  if (!rectilinear || ring.length === 4) return [box];
  const levels = [...new Set(ys)].sort((a, b) => a - b);
  const out: [number, number, number, number][] = [];
  for (let i = 0; i + 1 < levels.length; i++) {
    const y0 = levels[i] as number;
    const y1 = levels[i + 1] as number;
    const mid = (y0 + y1) / 2;
    // Vertical edges crossing the strip, left to right, pair up as inside spans.
    const cuts: number[] = [];
    ring.forEach((p, k) => {
      const q = ring[(k + 1) % ring.length] as { x: number; y: number };
      if (p.x === q.x && Math.min(p.y, q.y) < mid && Math.max(p.y, q.y) > mid) cuts.push(p.x);
    });
    cuts.sort((a, b) => a - b);
    for (let c = 0; c + 1 < cuts.length; c += 2)
      out.push([cuts[c] as number, y0, cuts[c + 1] as number, y1]);
  }
  return out.length ? out : [box];
}

type Key = keyof typeof ASSETS;
const TURNS: Record<"north" | "south" | "west" | "east", number> = {
  north: 0,
  south: Math.PI,
  west: Math.PI / 2,
  east: -Math.PI / 2,
};

/**
 * Furniture for a room the walls enclose, chosen by what the sheet calls it: a living room gets a sofa facing a media
 * unit with a television, a study a desk and chair, a dining room a table and chairs, a store shelving. Other rooms are
 * left empty rather than guessed at. Pieces are the CC0 models in the catalog, placed against the room's longest wall.
 */
function furnishRoom(
  id: string,
  name: string,
  kind: string,
  box: [number, number, number, number],
  ceiling: number,
): SceneNode[] | undefined {
  const [x0, z0, x1, z1] = box;
  const w = x1 - x0;
  const d = z1 - z0;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const nodes: SceneNode[] = [];
  let n = 0;
  const put = (
    key: Key,
    x: number,
    z: number,
    turn: number,
    o: { scale?: [number, number, number]; lift?: number } = {},
  ) => {
    const a = ASSETS[key];
    const sc = o.scale ?? [1, 1, 1];
    nodes.push({
      id: `${id}.${key}.${n++}`,
      name: key,
      type: "furniture",
      roomId: id,
      geometry: {
        kind: "asset",
        id: a.id,
        size: [a.w * sc[0], a.h * sc[1], a.d * sc[2]],
        ...(o.scale ? { scale: o.scale } : {}),
      },
      position: [x, o.lift ?? 0, z],
      rotationY: turn + (a.yaw ?? 0),
      material: "oak",
      tags: ["furniture", key],
    });
  };
  const box3 = (
    nm: string,
    size: [number, number, number],
    at: [number, number, number],
    turn: number,
    material: string,
  ) =>
    nodes.push({
      id: `${id}.${nm}.${n++}`,
      name: nm,
      type: "furniture",
      roomId: id,
      geometry: { kind: "box", size },
      position: at,
      rotationY: turn,
      material,
      tags: ["furniture", nm],
    });
  // The room seen along its long axis: the longest wall is the back, the other direction runs into the room.
  const long = w >= d ? "x" : "z";
  const back = long === "x" ? "north" : "west";
  const front = long === "x" ? "south" : "east";
  const L = long === "x" ? w : d;
  const S = long === "x" ? d : w;
  const along = (u: number, v: number, fromBack: boolean): [number, number] => {
    // u metres along the long wall from its middle, v metres in from the back (or the front) wall
    const vv = fromBack ? v : S - v;
    return long === "x" ? [cx + u, z0 + vv] : [x0 + vv, cz + u];
  };
  const faceIn = TURNS[back];
  const faceOut = TURNS[front];
  void L;
  if (kind === "residential.living" && S >= 2.8 && L >= 3) {
    const a = ASSETS.sofaSmall;
    put("sofaSmall", ...along(0, a.d / 2 + 0.12, true), faceIn);
    put("coffeeTableLong", ...along(0, a.d + 0.9, true), faceIn);
    put("sideTable", ...along(a.w / 2 + 0.45, 0.35, true), faceIn);
    put("vase", ...along(a.w / 2 + 0.45, 0.35, true), faceIn, { lift: 0.55 });
    // A media unit on the wall opposite, with the television on it, both facing the sofa.
    const [mx, mz] = along(0, 0.35, false);
    put("cabinet", mx, mz, faceOut);
    const tvY = ASSETS.cabinet.h;
    box3(
      "television",
      long === "x" ? [1.1, 0.64, 0.05] : [0.05, 0.64, 1.1],
      [mx, tvY + 0.34, mz],
      0,
      "screen",
    );
    return nodes;
  }
  if (kind === "residential.study" && S >= 2.2 && L >= 2.4) {
    put("officeDesk", ...along(0, 0.5, true), faceIn);
    put("swivelChair", ...along(0, 1.15, true), faceOut, { scale: [0.7, 0.7, 0.7] });
    put("bookcase", ...along(L / 2 - 0.7, 0.3, false), faceOut);
    return nodes;
  }
  if (kind === "residential.dining" && S >= 2.6 && L >= 2.6) {
    const tw = Math.min(L - 1.6, 2.4);
    const td = Math.min(S - 1.6, 1.1);
    if (tw < 1.2 || td < 0.8) return undefined;
    const a = ASSETS.meetingTable;
    put("meetingTable", cx, cz, long === "x" ? 0 : Math.PI / 2, {
      scale: [tw / a.w, 0.84, td / a.d],
    });
    const seats = Math.max(2, Math.floor(tw / 0.62));
    for (let i = 0; i < seats; i++) {
      const u = -((seats - 1) * 0.62) / 2 + i * 0.62;
      for (const sign of [-1, 1]) {
        const off = sign * (td / 2 + 0.12);
        const [px, pz] = long === "x" ? [cx + u, cz + off] : [cx + off, cz + u];
        put(
          "diningChair",
          px,
          pz,
          long === "x" ? (sign < 0 ? 0 : Math.PI) : sign < 0 ? Math.PI / 2 : -Math.PI / 2,
        );
      }
    }
    return nodes;
  }
  if (kind === "residential.storage" && L >= 1.2) {
    const count = Math.max(1, Math.floor((L - 0.4) / 0.65));
    for (let i = 0; i < Math.min(count, 5); i++)
      put(
        "steelShelves",
        ...along(
          -((Math.min(count, 5) - 1) * 0.65) / 2 + i * 0.65,
          ASSETS.steelShelves.d / 2 + 0.05,
          true,
        ),
        faceIn,
      );
    return nodes;
  }
  void name;
  void ceiling;
  return undefined;
}

const floorFor = (kind: string) =>
  /toilet|shower|bath|kitchen|pantry|restroom|wc|lobby/.test(kind)
    ? "floor.tile"
    : "floor.wood.light";

export function sceneFromModel(model: SpatialModel): DrawnScene {
  const level = model.levels[0];
  if (!level) throw new Error("the model has no level");
  const bx = level.boundary.outer.map((p) => p.x);
  const by = level.boundary.outer.map((p) => p.y);
  const ox = Math.min(...bx);
  const oy = Math.min(...by);
  const W = (Math.max(...bx) - ox) * M;
  const D = (Math.max(...by) - oy) * M;
  const H = level.heightMm * M;
  const nodes: SceneNode[] = [];
  const at = (x: number, y: number) => [(x - ox) * M, (y - oy) * M] as const;

  // The slab under the whole building, then each room's floor on it.
  nodes.push({
    id: "slab",
    name: "Floor",
    type: "floor",
    geometry: { kind: "box", size: [W, 0.05, D] },
    position: [W / 2, -0.03, D / 2],
    rotationY: 0,
    material: "floor.tile",
    tags: ["floor"],
  });
  for (const s of model.spaces) {
    rectangles(s.boundary.outer).forEach(([x0, y0, x1, y1], i) => {
      const [cx, cy] = at((x0 + x1) / 2, (y0 + y1) / 2);
      nodes.push({
        id: `floor.${s.id}.${i}`,
        name: `${s.name} floor`,
        type: "floor",
        roomId: s.id,
        geometry: { kind: "box", size: [(x1 - x0) * M, 0.05, (y1 - y0) * M] },
        position: [cx, -0.025, cy],
        rotationY: 0,
        material: floorFor(s.kind),
        tags: ["floor"],
      });
    });
  }
  nodes.push({
    id: "ceiling",
    name: "Ceiling",
    type: "ceiling",
    geometry: { kind: "box", size: [W, 0.1, D] },
    position: [W / 2, H + 0.05, D / 2],
    rotationY: 0,
    material: "ceiling",
    tags: ["ceiling"],
  });

  // Walls, cut at their openings.
  const footprints: [number, number, number, number][] = [];
  for (const w of model.walls) {
    if (w.kind === "virtual") continue;
    const dx = w.b.x - w.a.x;
    const dy = w.b.y - w.a.y;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;
    const ux = dx / len;
    const uy = dy / len;
    const t = w.thicknessMm * M;
    const rot = -Math.atan2(dy, dx);
    const material = w.kind === "exterior" ? "wall.exterior" : "wall.interior";
    footprints.push([
      Math.min(w.a.x, w.b.x) - w.thicknessMm / 2,
      Math.min(w.a.y, w.b.y) - w.thicknessMm / 2,
      Math.max(w.a.x, w.b.x) + w.thicknessMm / 2,
      Math.max(w.a.y, w.b.y) + w.thicknessMm / 2,
    ]);
    const piece = (
      id: string,
      s0: number,
      s1: number,
      y0: number,
      y1: number,
      mat: string,
      type: SceneNode["type"],
      thick = t,
    ) => {
      if (s1 - s0 < 1 || y1 - y0 < 0.001) return;
      const mid = (s0 + s1) / 2;
      const [cx, cy] = at(w.a.x + ux * mid, w.a.y + uy * mid);
      nodes.push({
        id: `${w.id}.${id}`,
        name: type === "window" ? "Window glass" : "Wall",
        type,
        geometry: { kind: "box", size: [(s1 - s0) * M, y1 - y0, thick] },
        position: [cx, (y0 + y1) / 2, cy],
        rotationY: rot,
        material: mat,
        tags: [type],
      });
    };
    const ops = model.openings
      .filter((o) => o.hostWallId === w.id)
      .sort((a, b) => a.offsetMm - b.offsetMm);
    let cursor = 0;
    ops.forEach((o, i) => {
      const s0 = Math.max(cursor, o.offsetMm);
      const s1 = Math.min(len, o.offsetMm + o.widthMm);
      piece(`seg${i}`, cursor, s0, 0, H, material, "wall");
      if (o.kind === "window") {
        piece(`sill${i}`, s0, s1, 0, WINDOW_SILL, material, "wall");
        piece(`head${i}`, s0, s1, WINDOW_HEAD, H, material, "wall");
        piece(`glass${i}`, s0, s1, WINDOW_SILL, WINDOW_HEAD, "glass", "window", 0.04);
      } else piece(`lintel${i}`, s0, s1, DOOR_HEAD, H, material, "wall");
      cursor = Math.max(cursor, s1);
    });
    piece("end", cursor, len, 0, H, material, "wall");
  }

  // Ceiling lights on a grid, kept out of the walls, so the rooms are lit and the realistic renderer has lights.
  const cell = 3500;
  for (let x = ox + cell / 2; x < ox + W / M; x += cell)
    for (let y = oy + cell / 2; y < oy + D / M; y += cell) {
      if (
        footprints.some(([a, b, c, d]) => x > a - 300 && x < c + 300 && y > b - 300 && y < d + 300)
      )
        continue;
      const [cx, cy] = at(x, y);
      nodes.push({
        id: `light.${Math.round(cx * 10)}.${Math.round(cy * 10)}`,
        name: "Ceiling light",
        type: "light",
        geometry: { kind: "box", size: [0.6, 0.03, 0.6] },
        position: [cx, H - 0.02, cy],
        rotationY: 0,
        material: "light.warm",
        tags: ["light"],
      });
    }

  // Furnish the rooms the walls enclose, by name; the rest stay as drawn.
  const furnished: string[] = [];
  for (const s of model.spaces) {
    const xs = s.boundary.outer.map((p) => p.x);
    const ys = s.boundary.outer.map((p) => p.y);
    const [ax, ay] = at(Math.min(...xs), Math.min(...ys));
    const [bx2, by2] = at(Math.max(...xs), Math.max(...ys));
    // Keep a wall's thickness clear of the room edge.
    const pieces = furnishRoom(s.id, s.name, s.kind, [ax + 0.1, ay + 0.1, bx2 - 0.1, by2 - 0.1], H);
    if (pieces?.length) {
      nodes.push(...pieces);
      furnished.push(s.name);
    }
  }

  const labels = model.spaces.map((s) => {
    const xs = s.boundary.outer.map((p) => p.x);
    const ys = s.boundary.outer.map((p) => p.y);
    const [x, y] = at(
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
    );
    return { name: s.name, x, y };
  });
  // One place to stand: the middle of the largest room, or of the building when no room is closed.
  const biggest = [...model.spaces].sort(
    (a, b) => area(b.boundary.outer) - area(a.boundary.outer),
  )[0];
  const target = biggest ? labels[model.spaces.indexOf(biggest)] : undefined;
  const px = target?.x ?? W / 2;
  const pz = target?.y ?? D / 2;
  const viewpoints: Viewpoint[] = [
    {
      id: "inside",
      name: biggest?.name ?? "Inside",
      position: [px, 1.6, pz],
      target: [px + 2, 1.4, pz - 2],
      fovDeg: 70,
      ...(biggest ? { roomId: biggest.id } : {}),
    },
  ];
  return {
    scene: { ceilingM: H, nodes, materials: MATERIALS, shell: { w: W, h: D } },
    labels,
    viewpoints,
    furnished,
  };
}

function area(ring: Ring): number {
  let a = 0;
  ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length] as { x: number; y: number };
    a += p.x * q.y - q.x * p.y;
  });
  return Math.abs(a) / 2;
}
