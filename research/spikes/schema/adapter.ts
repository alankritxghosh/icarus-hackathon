// Builds a draft v2 model from axis-aligned space rectangles (the shape of every v1 plan and of the
// solver spikes). This is the M0 adapter in miniature: it proves the new model can hold what the
// current engine produces, including walls with openings that v1 only derives at render time.
import { GENERATED, type SpatialModel, type Vertex } from "./spatial.ts";

export interface RectSpace { id: string; kind: string; name: string; x0: number; y0: number; x1: number; y1: number; capacity?: number; targetAreaM2?: number }
export interface DoorSpec { space: string; to?: string; x?: number; y?: number; widthMm: number }
export interface Build {
  name: string;
  /** Level outline, counter-clockwise numerically (x then y), axis-aligned. */
  boundary: Vertex[];
  spaces: RectSpace[];
  /** Explicit doors; rooms without one get a door onto their longest shared wall with circulation. */
  doors?: DoorSpec[];
  entrance: { x: number; y: number; widthMm: number };
  levelId?: string;
}

const EXT_MM = 250;
const INT_MM = 100;
const rectRing = (s: RectSpace): Vertex[] => [{ x: s.x0, y: s.y0 }, { x: s.x1, y: s.y0 }, { x: s.x1, y: s.y1 }, { x: s.x0, y: s.y1 }];

type Atom = { o: "h" | "v"; c: number; a: number; b: number; left?: string; right?: string };

function onBoundary(boundary: Vertex[], x: number, y: number) {
  for (let i = 0; i < boundary.length; i++) {
    const p = boundary[i] as Vertex, q = boundary[(i + 1) % boundary.length] as Vertex;
    const minx = Math.min(p.x, q.x) - 1, maxx = Math.max(p.x, q.x) + 1, miny = Math.min(p.y, q.y) - 1, maxy = Math.max(p.y, q.y) + 1;
    if (x >= minx && x <= maxx && y >= miny && y <= maxy && (p.x === q.x ? Math.abs(x - p.x) <= 1 : Math.abs(y - p.y) <= 1)) return true;
  }
  return false;
}

export function buildModel(b: Build): SpatialModel {
  const levelId = b.levelId ?? "L0";
  const atoms: Atom[] = [];
  // 1. every space edge, tagged with the space and the side it lies on
  type Edge = { o: "h" | "v"; c: number; a: number; b: number; space: string; side: "left" | "right" };
  const edges: Edge[] = [];
  for (const s of b.spaces) {
    edges.push({ o: "h", c: s.y0, a: s.x0, b: s.x1, space: s.id, side: "left" }); // space below a horizontal wall = left of a->b
    edges.push({ o: "h", c: s.y1, a: s.x0, b: s.x1, space: s.id, side: "right" });
    edges.push({ o: "v", c: s.x1, a: s.y0, b: s.y1, space: s.id, side: "left" }); // space west of a vertical wall = left of a->b
    edges.push({ o: "v", c: s.x0, a: s.y0, b: s.y1, space: s.id, side: "right" });
  }
  // 2. split each line at every breakpoint so shared walls are exact
  const lines = new Map<string, Edge[]>();
  for (const e of edges) lines.set(`${e.o}:${e.c}`, [...(lines.get(`${e.o}:${e.c}`) ?? []), e]);
  for (const [key, list] of lines) {
    const [o, cs] = key.split(":") as ["h" | "v", string];
    const cuts = [...new Set(list.flatMap((e) => [e.a, e.b]))].sort((p, q) => p - q);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i] as number, bb = cuts[i + 1] as number;
      const atom: Atom = { o, c: Number(cs), a, b: bb };
      for (const e of list) if (e.a <= a && e.b >= bb) atom[e.side] = e.space;
      if (atom.left || atom.right) atoms.push(atom);
    }
  }
  // 3. outside is "exterior" where the atom lies on the level outline
  for (const at of atoms) {
    const mx = at.o === "h" ? (at.a + at.b) / 2 : at.c;
    const my = at.o === "h" ? at.c : (at.a + at.b) / 2;
    if (onBoundary(b.boundary, mx, my)) {
      if (!at.left) at.left = "exterior";
      if (!at.right) at.right = "exterior";
    }
  }
  // 4. merge neighbouring atoms with the same pair of sides into one wall
  atoms.sort((p, q) => (p.o + p.c).localeCompare(q.o + q.c) || p.a - q.a);
  const merged: Atom[] = [];
  for (const at of atoms) {
    const last = merged[merged.length - 1];
    if (last && last.o === at.o && last.c === at.c && last.b === at.a && last.left === at.left && last.right === at.right) last.b = at.b;
    else merged.push({ ...at });
  }
  const circ = (id?: string) => !!id && !!b.spaces.find((s) => s.id === id)?.kind.startsWith("circulation");
  const walls = merged.map((at, i) => {
    const ext = at.left === "exterior" || at.right === "exterior";
    if (circ(at.left) && circ(at.right))
      return { id: `wall.${i + 1}`, levelId, a: at.o === "h" ? { x: at.a, y: at.c } : { x: at.c, y: at.a }, b: at.o === "h" ? { x: at.b, y: at.c } : { x: at.c, y: at.b }, thicknessMm: 20, kind: "virtual" as const, structural: "non_structural" as const, left: at.left, right: at.right, provenance: GENERATED };
    return {
      id: `wall.${i + 1}`,
      levelId,
      a: at.o === "h" ? { x: at.a, y: at.c } : { x: at.c, y: at.a },
      b: at.o === "h" ? { x: at.b, y: at.c } : { x: at.c, y: at.b },
      thicknessMm: ext ? EXT_MM : INT_MM,
      kind: ext ? ("exterior" as const) : ("interior" as const),
      structural: ext ? ("unknown" as const) : ("non_structural" as const),
      left: at.left,
      right: at.right,
      provenance: GENERATED,
    };
  });

  // 5. doors: explicit ones first, then one automatic door per room onto circulation
  const openings: SpatialModel["openings"] = [];
  const wallsOf = (sp: string, other?: string) => walls.filter((w) => (w.left === sp && (!other || w.right === other)) || (w.right === sp && (!other || w.left === other)));
  const along = (w: (typeof walls)[number], x: number, y: number) => (w.a.x === w.b.x ? y - w.a.y : x - w.a.x);
  const length = (w: (typeof walls)[number]) => Math.abs(w.b.x - w.a.x) + Math.abs(w.b.y - w.a.y);
  let n = 0;
  const isCirc = (id: string) => b.spaces.find((s) => s.id === id)?.kind.startsWith("circulation");
  const placeDoor = (w: (typeof walls)[number], centreAlong: number, widthMm: number, entrance = false) => {
    const offset = Math.max(0, Math.min(length(w) - widthMm, Math.round(centreAlong - widthMm / 2)));
    openings.push({ id: `door.${++n}`, hostWallId: w.id, kind: "door", offsetMm: offset, widthMm, sillMm: 0, headMm: 2100, entrance, provenance: GENERATED });
  };
  const specs = new Map((b.doors ?? []).map((d) => [d.space, d]));
  for (const s of b.spaces) {
    if (isCirc(s.id)) continue;
    const spec = specs.get(s.id);
    const candidates = wallsOf(s.id).filter((w) => {
      const other = w.left === s.id ? w.right : w.left;
      return other && other !== "exterior" && isCirc(other);
    });
    if (!candidates.length) continue;
    let host = candidates[0] as (typeof walls)[number];
    let centre: number | undefined;
    if (spec?.x !== undefined && spec.y !== undefined) {
      const hit = candidates.find((w) => (w.a.x === w.b.x ? Math.abs(spec.x! - w.a.x) <= 2 && spec.y! >= w.a.y - 2 && spec.y! <= w.b.y + 2 : Math.abs(spec.y! - w.a.y) <= 2 && spec.x! >= w.a.x - 2 && spec.x! <= w.b.x + 2));
      if (hit) { host = hit; centre = along(hit, spec.x, spec.y); }
    }
    if (centre === undefined) {
      host = candidates.reduce((best, w) => (length(w) > length(best) ? w : best), host);
      centre = length(host) / 2;
    }
    placeDoor(host, centre, spec?.widthMm ?? 900);
  }
  // the front door: an exterior wall passing through the entrance point, on a circulation space
  const front = walls.find((w) => (w.left === "exterior" || w.right === "exterior") && (w.a.x === w.b.x ? Math.abs(b.entrance.x - w.a.x) <= 2 && b.entrance.y >= w.a.y && b.entrance.y <= w.b.y : Math.abs(b.entrance.y - w.a.y) <= 2 && b.entrance.x >= w.a.x && b.entrance.x <= w.b.x));
  if (front) placeDoor(front, along(front, b.entrance.x, b.entrance.y), b.entrance.widthMm, true);

  return {
    schema: "icarus.spatial/0.1",
    units: "mm",
    name: b.name,
    northDeg: 0,
    levels: [{ id: levelId, name: "Level 0", elevationMm: 0, heightMm: 2900, boundary: { outer: b.boundary, holes: [] }, provenance: GENERATED }],
    spaces: b.spaces.map((s) => ({
      id: s.id, levelId, kind: s.kind, name: s.name, boundary: { outer: rectRing(s), holes: [] },
      programme: { capacity: s.capacity, targetAreaM2: s.targetAreaM2 }, locked: false, provenance: GENERATED,
    })),
    walls,
    openings,
    obstacles: [],
    connectors: [],
    items: [],
  };
}
