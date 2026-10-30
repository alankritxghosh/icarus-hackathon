// Builds a 3D scene (the shape list the viewer draws and exports) from a spatial model: walls with their doors and
// windows cut through, a floor, a ceiling and ceiling lights. It draws what the model holds and nothing more: no
// furniture is invented for a model that has none. Floors inside the building are always tile or wood.
import { MATERIALS, type Scene, type SceneNode, type Viewpoint } from "@icarus/core";
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
