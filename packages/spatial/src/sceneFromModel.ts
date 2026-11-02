// Builds a 3D scene (the shape list the viewer draws and exports) from a spatial model: walls with their doors and
// windows cut through, a floor, a ceiling and ceiling lights. It draws what the model holds and nothing more: no
// furniture is invented for a model that has none. Floors inside the building are always tile or wood.
import { ASSETS, MATERIALS, type Scene, type SceneNode, type Viewpoint } from "@icarus/core";
import type { SpatialModel } from "./schema";

const M = 1 / 1000;
const WINDOW_SILL = 0.9;
const WINDOW_HEAD = 2.1;
const DOOR_HEAD = 2.1;
const DRAWING_MATERIALS: Scene["materials"] = {
  ...MATERIALS,
  "wall.inferred": {
    color: "#d98a54",
    roughness: 0.9,
    metalness: 0,
    opacity: 0.3,
  },
  "wall.traced": {
    color: "#e4d7c6",
    pbr: "plastered_wall",
    tileM: 2,
    roughness: 0.9,
    metalness: 0,
    opacity: 0.9,
  },
  "floor.landscape": {
    color: "#ffffff",
    pbr: "leafy_grass",
    tileM: 2,
    roughness: 1,
    metalness: 0,
    opacity: 1,
  },
  "roof.terrace": {
    color: "#f0e8dc",
    pbr: "clay_roof_tiles_02",
    tileM: 1.5,
    roughness: 1,
    metalness: 0,
    opacity: 1,
  },
};

export interface DrawnScene {
  scene: Scene;
  /** Room names at their centres, in scene metres, for the plan view. */
  labels: { name: string; x: number; y: number; w: number; h: number }[];
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
  entryAtBack = false,
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
  const back = long === "x" ? (entryAtBack ? "south" : "north") : entryAtBack ? "east" : "west";
  const front = long === "x" ? (entryAtBack ? "north" : "south") : entryAtBack ? "west" : "east";
  const L = long === "x" ? w : d;
  const S = long === "x" ? d : w;
  const along = (u: number, v: number, fromBack: boolean): [number, number] => {
    // u metres along the long wall from its middle, v metres in from the back (or the front) wall
    const edge = fromBack ? back : front;
    return long === "x"
      ? [cx + u, edge === "north" ? z0 + v : z1 - v]
      : [edge === "west" ? x0 + v : x1 - v, cz + u];
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

  type Part = [string, [number, number, number], [number, number, number], string];
  /** A piece made of boxes, in its own frame (x across, y up, z toward its front), placed and turned in the room. */
  const group = (nm: string, parts: Part[], x: number, z: number, turn: number) => {
    const c = Math.cos(turn);
    const sn = Math.sin(turn);
    for (const [, size, [px, py, pz], mat] of parts)
      nodes.push({
        id: `${id}.${nm}.${n++}`,
        name: nm,
        type: "furniture",
        roomId: id,
        geometry: { kind: "box", size },
        position: [x + px * c + pz * sn, py, z - px * sn + pz * c],
        rotationY: turn,
        material: mat,
        tags: ["furniture", nm],
      });
  };
  const WHITE = "laminate.white";

  if (kind === "residential.bedroom" && S >= 2.5 && L >= 2.6) {
    const bw = Math.min(1.6, L - 1.2);
    const bd = 2.0;
    const [bx, bz] = along(0, bd / 2 + 0.05, true);
    // The head is against the wall, between a bedside table on each side; the foot faces the room.
    group(
      "bed",
      [
        ["frame", [bw, 0.3, bd], [0, 0.15, 0], "oak.dark"],
        ["mattress", [bw - 0.1, 0.22, bd - 0.12], [0, 0.41, 0.02], WHITE],
        ["headboard", [bw, 0.9, 0.08], [0, 0.45, -bd / 2 + 0.04], "oak.dark"],
        ["pillow", [0.55, 0.12, 0.35], [-bw / 4, 0.58, -bd / 2 + 0.4], WHITE],
        ["pillow", [0.55, 0.12, 0.35], [bw / 4, 0.58, -bd / 2 + 0.4], WHITE],
        ["blanket", [bw - 0.1, 0.05, bd * 0.55], [0, 0.55, bd * 0.2], "fabric.charcoal"],
      ],
      bx,
      bz,
      faceIn,
    );
    if (L >= bw + 1.3)
      for (const sign of [-1, 1]) {
        const [sx, sz] = along(sign * (bw / 2 + 0.38), 0.3, true);
        put("sideTable", sx, sz, faceIn);
      }
    return nodes;
  }
  if (kind === "residential.wardrobe" && L >= 1.2 && S >= 1.0) {
    const count = Math.max(1, Math.floor((L - 0.3) / 0.65));
    for (let i = 0; i < Math.min(count, 5); i++)
      put(
        "bookcase",
        ...along(
          -((Math.min(count, 5) - 1) * 0.65) / 2 + i * 0.65,
          ASSETS.bookcase.d / 2 + 0.05,
          true,
        ),
        faceIn,
      );
    return nodes;
  }
  if (kind === "residential.toilet" && L >= 1.2 && S >= 1.2) {
    const [tx, tz] = along(-0.3, 0.4, true);
    group(
      "toilet",
      [
        ["bowl", [0.38, 0.4, 0.5], [0, 0.2, 0.05], WHITE],
        ["cistern", [0.38, 0.4, 0.18], [0, 0.6, -0.2], WHITE],
      ],
      tx,
      tz,
      faceIn,
    );
    if (L >= 1.8) {
      const [bx, bz] = along(0.5, 0.3, true);
      group(
        "basin",
        [
          ["pedestal", [0.14, 0.78, 0.14], [0, 0.39, -0.05], WHITE],
          ["bowl", [0.5, 0.12, 0.4], [0, 0.84, 0], WHITE],
        ],
        bx,
        bz,
        faceIn,
      );
    }
    return nodes;
  }
  if (kind === "residential.shower" && L >= 1.0 && S >= 1.0) {
    const [sx, sz] = along(-L / 2 + 0.55, 0.55, true);
    group(
      "shower",
      [
        ["tray", [0.9, 0.06, 0.9], [0, 0.03, 0], WHITE],
        [
          "screen",
          long === "x" ? [0.9, 2.0, 0.02] : [0.02, 2.0, 0.9],
          long === "x" ? [0, 1.0, 0.45] : [0.45, 1.0, 0],
          "glass",
        ],
      ],
      sx,
      sz,
      0,
    );
    return nodes;
  }
  if (kind === "residential.kitchen" && L >= 2.4 && S >= 1.8) {
    put("cabinet", ...along(0, ASSETS.cabinet.d / 2 + 0.05, true), faceIn);
    const [hx, hz] = along(0, 0.35, true);
    group("hob", [["plate", [0.6, 0.03, 0.5], [0, 0.7, 0], "metal.black"]], hx, hz, faceIn);
    const [fx, fz] = along(-ASSETS.cabinet.w / 2 - 0.45, 0.4, true);
    group("fridge", [["body", [0.7, 1.8, 0.7], [0, 0.9, 0], "steel"]], fx, fz, faceIn);
    return nodes;
  }
  if (kind === "residential.gym" && L >= 2.4 && S >= 2.2) {
    const tread: Part[] = [
      ["belt", [0.7, 0.14, 1.5], [0, 0.17, 0.12], "metal.black"],
      ["hood", [0.8, 0.22, 0.32], [0, 0.22, -0.7], "oak.dark"],
      ["upright", [0.05, 1.0, 0.05], [-0.36, 0.78, -0.7], "steel"],
      ["upright", [0.05, 1.0, 0.05], [0.36, 0.78, -0.7], "steel"],
      ["console", [0.7, 0.24, 0.12], [0, 1.18, -0.7], "metal.black"],
    ];
    const per = Math.min(2, Math.floor((L - 0.4) / 1.0));
    for (let i = 0; i < per; i++)
      group("treadmill", tread, ...along(-((per - 1) * 1.0) / 2 + i * 1.0, 1.0, true), faceIn);
    // A bench with a barbell toward the front, and a dumbbell rack on the back wall at one end.
    group(
      "weight bench",
      [
        ["pad", [0.32, 0.09, 1.1], [0, 0.45, 0], "metal.black"],
        ["leg", [0.08, 0.4, 1.0], [0, 0.22, 0], "steel"],
        ["bar", [1.6, 0.03, 0.03], [0, 1.08, -0.5], "steel"],
        ["stand", [0.06, 1.1, 0.06], [-0.7, 0.55, -0.5], "steel"],
        ["stand", [0.06, 1.1, 0.06], [0.7, 0.55, -0.5], "steel"],
      ],
      ...along(0, S - 1.1, true),
      faceIn,
    );
    if (L >= 3.4)
      group(
        "dumbbell rack",
        [
          ["shelf", [1.3, 0.04, 0.4], [0, 0.45, 0], "steel"],
          ["shelf", [1.3, 0.04, 0.4], [0, 0.75, 0], "steel"],
          ["weights", [1.2, 0.18, 0.2], [0, 0.56, 0], "metal.black"],
          ["weights", [1.2, 0.18, 0.2], [0, 0.86, 0], "metal.black"],
        ],
        ...along(L / 2 - 0.9, 0.3, true),
        faceIn,
      );
    return nodes;
  }
  void name;
  void ceiling;
  return undefined;
}

const floorFor = (kind: string, finish?: SpatialModel["spaces"][number]["floorFinish"]) => {
  if (finish === "turf") return "floor.landscape";
  if (finish === "stone") return "floor.corridor";
  if (finish === "tile") return "floor.tile";
  if (finish === "concrete") return "floor.concrete";
  if (finish === "wood") return "floor.wood.light";
  return /toilet|shower|bath|kitchen|pantry|restroom|wc|lobby/.test(kind)
    ? "floor.tile"
    : "floor.wood.light";
};

function singleLevelSceneFromModel(model: SpatialModel, topLevel = true): DrawnScene {
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
  const traced = model.spaces.some((space) => space.provenance.source === "estimated");
  if (!traced)
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
        material: floorFor(s.kind, s.floorFinish),
        tags: ["floor"],
      });
      if (traced && !s.kind.startsWith("exterior.") && !s.kind.startsWith("circulation.lift"))
        nodes.push({
          id: `roof.${s.id}.${i}`,
          name: topLevel ? `${s.name} roof` : `${s.name} ceiling`,
          type: "ceiling",
          roomId: s.id,
          geometry: { kind: "box", size: [(x1 - x0) * M, 0.16, (y1 - y0) * M] },
          position: [cx, H + 0.08, cy],
          rotationY: 0,
          material: topLevel ? "roof.terrace" : "ceiling",
          tags: topLevel ? ["roof"] : ["ceiling"],
        });
    });
  }
  if (!traced)
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
    const material =
      w.provenance.source === "inferred"
        ? "wall.inferred"
        : w.provenance.source === "estimated"
          ? "wall.traced"
          : w.kind === "exterior"
            ? "wall.exterior"
            : "wall.interior";
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
  if (!traced)
    for (let x = ox + cell / 2; x < ox + W / M; x += cell)
      for (let y = oy + cell / 2; y < oy + D / M; y += cell) {
        if (
          footprints.some(
            ([a, b, c, d]) => x > a - 300 && x < c + 300 && y > b - 300 && y < d + 300,
          )
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
    const longX = bx2 - ax >= by2 - ay;
    const backWall = `${s.id}.w${longX ? 0 : 3}`;
    const entryAtBack =
      (s.kind === "residential.bedroom" || s.kind === "residential.study") &&
      model.openings.some(
        (opening) => opening.hostWallId === backWall && opening.kind !== "window",
      );
    const pieces = furnishRoom(
      s.id,
      s.name,
      s.kind,
      [ax + 0.1, ay + 0.1, bx2 - 0.1, by2 - 0.1],
      H,
      entryAtBack,
    );
    if (pieces?.length) {
      const clearances = model.openings.flatMap((opening) => {
        if (opening.kind === "window" || !opening.hostWallId.startsWith(`${s.id}.w`)) return [];
        const wall = model.walls.find((part) => part.id === opening.hostWallId);
        if (!wall) return [];
        const dx = wall.b.x - wall.a.x;
        const dz = wall.b.y - wall.a.y;
        const length = Math.hypot(dx, dz);
        if (!length) return [];
        const middle = opening.offsetMm + opening.widthMm / 2;
        const [x, z] = at(wall.a.x + (dx * middle) / length, wall.a.y + (dz * middle) / length);
        const side = Number(opening.hostWallId.at(-1));
        const horizontal = side === 0 || side === 2;
        const inward = side === 0 || side === 3 ? 0.55 : -0.55;
        return [
          {
            x: x + (horizontal ? 0 : inward),
            z: z + (horizontal ? inward : 0),
            halfW: horizontal ? (opening.widthMm * M) / 2 + 0.2 : 0.6,
            halfD: horizontal ? 0.6 : (opening.widthMm * M) / 2 + 0.2,
          },
        ];
      });
      let kept = pieces.filter((piece) => {
        if (piece.geometry.kind !== "asset") return true;
        const [w, , d] = piece.geometry.size;
        const c = Math.abs(Math.cos(piece.rotationY));
        const sn = Math.abs(Math.sin(piece.rotationY));
        const halfW = (c * w + sn * d) / 2;
        const halfD = (sn * w + c * d) / 2;
        return !clearances.some(
          (gap) =>
            Math.abs(piece.position[0] - gap.x) < halfW + gap.halfW &&
            Math.abs(piece.position[2] - gap.z) < halfD + gap.halfD,
        );
      });
      if (s.kind === "residential.living") {
        if (!kept.some((piece) => piece.name === "sofaSmall")) kept = [];
        else
          kept = kept.filter(
            (piece) =>
              (piece.name !== "vase" || kept.some((part) => part.name === "sideTable")) &&
              (piece.name !== "television" || kept.some((part) => part.name === "cabinet")),
          );
      }
      nodes.push(...kept);
      if (kept.length) furnished.push(s.name);
    }
  }

  const labels = model.spaces.map((s) => {
    const xs = s.boundary.outer.map((p) => p.x);
    const ys = s.boundary.outer.map((p) => p.y);
    const [x, y] = at(
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
    );
    return {
      name: s.name,
      x,
      y,
      w: (Math.max(...xs) - Math.min(...xs)) * M,
      h: (Math.max(...ys) - Math.min(...ys)) * M,
    };
  });
  // One place to stand: the middle of the largest room, or of the building when no room is closed.
  const biggest = [...model.spaces].sort(
    (a, b) => area(b.boundary.outer) - area(a.boundary.outer),
  )[0];
  const target = biggest ? labels[model.spaces.indexOf(biggest)] : undefined;
  const px = target?.x ?? W / 2;
  const pz = target?.y ?? D / 2;
  const roomXs = biggest?.boundary.outer.map((point) => point.x) ?? [];
  const roomZs = biggest?.boundary.outer.map((point) => point.y) ?? [];
  const roomW = roomXs.length ? (Math.max(...roomXs) - Math.min(...roomXs)) * M : W;
  const roomD = roomZs.length ? (Math.max(...roomZs) - Math.min(...roomZs)) * M : D;
  const viewpoints: Viewpoint[] = [
    {
      id: "inside",
      name: biggest?.name ?? "Inside",
      position: [px, 1.6, pz],
      target:
        roomW >= roomD
          ? [px + Math.min(1.2, roomW / 4), 1.4, pz]
          : [px, 1.4, pz + Math.min(1.2, roomD / 4)],
      fovDeg: 70,
      ...(biggest ? { roomId: biggest.id } : {}),
    },
  ];
  const lobby = labels.find((label) => /^lobby$/i.test(label.name));
  const foyer = labels.find((label) => /^foyer$/i.test(label.name));
  if (lobby && foyer) {
    const door = model.openings.find((opening) => opening.entrance);
    const wall = model.walls.find((item) => item.id === door?.hostWallId);
    let spawn: [number, number, number] = [lobby.x, 1.6, lobby.y];
    let facing: [number, number, number] = [foyer.x, 1.3, foyer.y];
    if (door && wall) {
      const length = Math.hypot(wall.b.x - wall.a.x, wall.b.y - wall.a.y);
      const mid = door.offsetMm + door.widthMm / 2;
      const [x, z] = at(
        wall.a.x + ((wall.b.x - wall.a.x) * mid) / length,
        wall.a.y + ((wall.b.y - wall.a.y) * mid) / length,
      );
      const horizontalWall = Math.abs(wall.a.y - wall.b.y) < 1;
      const nx = horizontalWall ? 0 : Math.sign(lobby.x - x);
      const nz = horizontalWall ? Math.sign(lobby.y - z) : 0;
      spawn = [x + nx * 1.2, 1.6, z + nz * 1.2];
      facing = [x - nx * 1.3, 1.3, z - nz * 1.3];
    }
    viewpoints.unshift({
      id: "entry",
      name: "East entrance",
      position: spawn,
      target: facing,
      fovDeg: 70,
    });
  } else if (lobby) {
    const destination =
      labels.find((label) => /family room|living room|transition space/i.test(label.name)) ??
      target;
    viewpoints.unshift({
      id: "landing",
      name: "Landing",
      position: [lobby.x, 1.6, lobby.y],
      target: [destination?.x ?? lobby.x, 1.3, destination?.y ?? lobby.y - 2],
      fovDeg: 70,
    });
  }
  return {
    scene: { ceilingM: H, nodes, materials: DRAWING_MATERIALS, shell: { w: W, h: D } },
    labels,
    viewpoints,
    furnished,
  };
}

/** Render every level of one building in a shared vertical frame. */
export function sceneFromModel(model: SpatialModel): DrawnScene {
  if (model.levels.length <= 1) return singleLevelSceneFromModel(model);
  const baseElevation = Math.min(...model.levels.map((level) => level.elevationMm));
  const globalX = Math.min(
    ...model.levels.flatMap((level) => level.boundary.outer.map((p) => p.x)),
  );
  const globalY = Math.min(
    ...model.levels.flatMap((level) => level.boundary.outer.map((p) => p.y)),
  );
  const levels = [...model.levels]
    .sort((a, b) => a.elevationMm - b.elevationMm)
    .map((level) => {
      const wallIds = new Set(
        model.walls.filter((wall) => wall.levelId === level.id).map((wall) => wall.id),
      );
      const spaces = model.spaces.filter((space) => space.levelId === level.id);
      const spaceIds = new Set(spaces.map((space) => space.id));
      const subset: SpatialModel = {
        ...model,
        levels: [level],
        spaces,
        walls: model.walls.filter((wall) => wall.levelId === level.id),
        openings: model.openings.filter((opening) => wallIds.has(opening.hostWallId)),
        obstacles: model.obstacles.filter((obstacle) => obstacle.levelId === level.id),
        connectors: [],
        items: model.items.filter((item) => spaceIds.has(item.spaceId)),
      };
      const localX = Math.min(...level.boundary.outer.map((p) => p.x));
      const localY = Math.min(...level.boundary.outer.map((p) => p.y));
      return {
        level,
        drawn: singleLevelSceneFromModel(
          subset,
          level.elevationMm === Math.max(...model.levels.map((item) => item.elevationMm)),
        ),
        dx: (localX - globalX) * M,
        dz: (localY - globalY) * M,
      };
    });
  const nodes = levels.flatMap(({ level, drawn, dx, dz }) =>
    drawn.scene.nodes.map((node) => ({
      ...node,
      id: `${level.id}.${node.id}`,
      position: [
        node.position[0] + dx,
        node.position[1] + (level.elevationMm - baseElevation) * M,
        node.position[2] + dz,
      ] as [number, number, number],
    })),
  );
  for (const connector of model.connectors) {
    if (connector.kind !== "stair" || !connector.path) continue;
    const width = (connector.clearWidthMm ?? 900) * M;
    for (let i = 0; i + 1 < connector.path.length; i++) {
      const a = connector.path[i] as NonNullable<typeof connector.path>[number];
      const b = connector.path[i + 1] as NonNullable<typeof connector.path>[number];
      const run = Math.hypot(b.x - a.x, b.y - a.y);
      const rise = b.elevationMm - a.elevationMm;
      const count = a.stepsToNext ?? Math.max(1, Math.ceil(rise / 160));
      if (run / count < 220 || rise < 0 || rise / count > 200)
        throw new Error(`stair ${connector.id} has an unwalkable flight segment`);
      for (let step = 0; step < count; step++) {
        const t = (step + 0.5) / count;
        const top = a.elevationMm + (rise * (step + 1)) / count;
        const x = (a.x + (b.x - a.x) * t - globalX) * M;
        const z = (a.y + (b.y - a.y) * t - globalY) * M;
        const rotationY = -Math.atan2(b.y - a.y, b.x - a.x);
        const treadRun = (run / count) * M;
        nodes.push({
          id: `stair.${connector.id}.${i}.${step}`,
          name: `Stair ${step + 1}`,
          type: "floor",
          geometry: { kind: "box", size: [treadRun + 0.02, 0.12, width] },
          position: [x, (top - baseElevation) * M - 0.06, z],
          rotationY,
          material: "floor.tile",
          tags: ["floor", "stair"],
        });
        // Fill each rise from the start of its flight. It remains a concept-stage
        // stair assembly, not a claim about the building's actual structure.
        if (rise > 0) {
          const bottom = (a.elevationMm - baseElevation) * M;
          const height = (top - a.elevationMm) * M - 0.12;
          if (height > 0)
            nodes.push({
              id: `stair.${connector.id}.${i}.${step}.riser`,
              name: "Stair riser",
              type: "fixture",
              geometry: { kind: "box", size: [treadRun, height, width] },
              position: [x, bottom + height / 2, z],
              rotationY,
              material: "floor.concrete",
              tags: ["stair", "riser"],
            });
        }
        // A pair of simple guard posts follows the same centreline as the treads.
        // Posts sit outside the clear walking width and are visual only.
        if (count > 1)
          for (const side of [-1, 1]) {
            const lateral = (width / 2 + 0.04) * side;
            const edgeX = x + Math.sin(rotationY) * lateral;
            const edgeZ = z + Math.cos(rotationY) * lateral;
            if (step % 2 === 0)
              nodes.push({
                id: `stair.${connector.id}.${i}.${step}.guard.${side}`,
                name: "Stair guard post",
                type: "fixture",
                geometry: { kind: "box", size: [0.04, 0.9, 0.04] },
                position: [edgeX, (top - baseElevation) * M + 0.45, edgeZ],
                rotationY,
                material: "floor.concrete",
                tags: ["stair", "guard"],
              });
            nodes.push({
              id: `stair.${connector.id}.${i}.${step}.rail.${side}`,
              name: "Stair handrail",
              type: "fixture",
              geometry: { kind: "box", size: [treadRun + 0.03, 0.04, 0.05] },
              position: [edgeX, (top - baseElevation) * M + 0.9, edgeZ],
              rotationY,
              material: "floor.concrete",
              tags: ["stair", "rail"],
            });
          }
      }
    }
  }
  const top = [...levels].sort((a, b) => b.level.elevationMm - a.level.elevationMm)[0];
  if (!top) throw new Error("the model has no level");
  return {
    scene: {
      ...top.drawn.scene,
      nodes,
      shell: {
        w: Math.max(...levels.map(({ drawn, dx }) => drawn.scene.shell.w + dx)),
        h: Math.max(...levels.map(({ drawn, dz }) => drawn.scene.shell.h + dz)),
      },
      ceilingM: Math.max(...model.levels.map((level) => level.elevationMm + level.heightMm)) * M,
    },
    // Plan labels follow the visible upper floor; each level still has named spaces in the saved model.
    labels: top.drawn.labels.map((label) => ({
      ...label,
      x: label.x + top.dx,
      y: label.y + top.dz,
    })),
    viewpoints: levels.flatMap(({ level, drawn, dx, dz }) =>
      drawn.viewpoints.map((viewpoint) => ({
        ...viewpoint,
        id: `${level.id}.${viewpoint.id}`,
        name: `${level.name}: ${viewpoint.name}`,
        position: [
          viewpoint.position[0] + dx,
          viewpoint.position[1] + (level.elevationMm - baseElevation) * M,
          viewpoint.position[2] + dz,
        ] as [number, number, number],
        target: [
          viewpoint.target[0] + dx,
          viewpoint.target[1] + (level.elevationMm - baseElevation) * M,
          viewpoint.target[2] + dz,
        ] as [number, number, number],
      })),
    ),
    furnished: levels.flatMap(({ drawn }) => drawn.furnished),
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
