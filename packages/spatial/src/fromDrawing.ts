// Builds a spatial model from the evidence read off a drawing: the walls the sheet draws, the gaps in them as openings,
// and the rooms its labels name wherever the walls actually enclose a space. Nothing is invented: a label whose room
// the walls do not close is reported as unplaced, never drawn as a guess, and everything made here is marked as
// measured from the drawing with a tolerance, so a later edit can see what came from the sheet.
//
// What it assumes: walls are the axis-aligned rectangles in the evidence; a wall gap of 650 to 1300 mm in an interior
// wall is a door and in an outer wall a window up to 3 m; the level is the bounding box of the walls (a notched or
// L-shaped building is therefore wrong at its notch, and says so); heights are the caller's.
import type { DrawingEvidence, Rect } from "./drawingAudit";
import { SCHEMA_VERSION, type SpatialModel } from "./schema";

export interface FromDrawingOptions {
  name?: string;
  levelHeightMm?: number;
  /** Positional tolerance to record on everything measured, millimetres. Default 50. */
  toleranceMm?: number;
  /**
   * Close the building's outline where the sheet draws no wall along it (many sheets draw the outer wall as a line,
   * not a fill). The added walls are marked inferred and counted in the report. Default true.
   */
  closeOutline?: boolean;
}

export interface FromDrawingReport {
  walls: number;
  /** Outer wall pieces added to close the outline where the sheet drew none, millimetres of wall. */
  closedMm: number;
  openings: number;
  spaces: number;
  /** Room labels whose room the walls do not enclose, so no space was made for them. */
  unplaced: string[];
  assumptions: string[];
}

type Prov = SpatialModel["levels"][number]["provenance"];

const CELL = 25;
const kindFromName = (name: string): string => {
  const n = name.toLowerCase();
  if (/bed ?room/.test(n)) return "residential.bedroom";
  if (/wardrobe|dressing/.test(n)) return "residential.wardrobe";
  if (/toilet|\bwc\b|powder|restroom/.test(n)) return "residential.toilet";
  if (/shower|bath/.test(n)) return "residential.shower";
  if (/kitchen|pantry/.test(n)) return "residential.kitchen";
  if (/\bgym\b/.test(n)) return "residential.gym";
  if (/study|office/.test(n)) return "residential.study";
  if (/dining/.test(n)) return "residential.dining";
  if (/\bstore\b|storage/.test(n)) return "residential.storage";
  if (/living|family|lounge|foyer/.test(n)) return "residential.living";
  return "drawing.room";
};

const thickness = (r: Rect) => Math.min(r[2] - r[0], r[3] - r[1]);

export function modelFromEvidence(
  evidence: DrawingEvidence,
  opts: FromDrawingOptions = {},
): { model: SpatialModel; report: FromDrawingReport } {
  if (!evidence.wallRects.length) throw new Error("the drawing has no walls to build a model from");
  const tol = opts.toleranceMm ?? 50;
  const prov: Prov = {
    source: "measured",
    toleranceMm: tol,
    evidence: [evidence.source.slice(0, 80)],
  };
  const rects = evidence.wallRects;
  const bx0 = Math.min(...rects.map((r) => r[0]));
  const by0 = Math.min(...rects.map((r) => r[1]));
  const bx1 = Math.max(...rects.map((r) => r[2]));
  const by1 = Math.max(...rects.map((r) => r[3]));
  const assumptions = [
    "the level outline is the bounding box of the walls",
    "a gap of 650 to 1300 mm in an interior wall is a door; in an outer wall, up to 3 m, a window",
    "wall structure is unknown: a drawing cannot say what is load-bearing",
  ];

  // Group wall rectangles that lie on one line (same centre line, same thickness) and read gaps between them as openings.
  const lines = new Map<string, Rect[]>();
  for (const r of rects) {
    const horizontal = r[2] - r[0] >= r[3] - r[1];
    const t = thickness(r);
    const centre = horizontal ? (r[1] + r[3]) / 2 : (r[0] + r[2]) / 2;
    const key = `${horizontal ? "h" : "v"}:${Math.round(centre / 40)}:${Math.round(t / 40)}`;
    lines.set(key, [...(lines.get(key) ?? []), r]);
  }
  const walls: SpatialModel["walls"] = [];
  const openings: SpatialModel["openings"] = [];
  let n = 0;
  for (const [key, group] of lines) {
    const horizontal = key.startsWith("h");
    const sorted = [...group].sort((p, q) => (horizontal ? p[0] - q[0] : p[1] - q[1]));
    const lo = (r: Rect) => (horizontal ? r[0] : r[1]);
    const hi = (r: Rect) => (horizontal ? r[2] : r[3]);
    const t = Math.max(...sorted.map(thickness));
    const centre = Math.round(
      sorted.reduce((acc, r) => acc + (horizontal ? (r[1] + r[3]) / 2 : (r[0] + r[2]) / 2), 0) /
        sorted.length,
    );
    const start = Math.min(...sorted.map(lo));
    const end = Math.max(...sorted.map(hi));
    const onEdge = horizontal
      ? Math.abs(centre - by0) < 1.5 * t + tol || Math.abs(centre - by1) < 1.5 * t + tol
      : Math.abs(centre - bx0) < 1.5 * t + tol || Math.abs(centre - bx1) < 1.5 * t + tol;
    const id = `w${++n}`;
    walls.push({
      id,
      levelId: "L1",
      a: horizontal ? { x: Math.round(start), y: centre } : { x: centre, y: Math.round(start) },
      b: horizontal ? { x: Math.round(end), y: centre } : { x: centre, y: Math.round(end) },
      thicknessMm: Math.max(20, Math.round(t)),
      kind: onEdge ? "exterior" : "interior",
      structural: "unknown",
      glazed: false,
      provenance: prov,
    });
    let reach = hi(sorted[0] as Rect);
    for (const r of sorted.slice(1)) {
      const gap = lo(r) - reach;
      if (gap >= 650) {
        const inner = !onEdge && gap <= 1300;
        const kind = onEdge ? (gap <= 3000 ? "window" : "passage") : inner ? "door" : "passage";
        openings.push({
          id: `o${openings.length + 1}`,
          hostWallId: id,
          kind,
          offsetMm: Math.round(reach - start),
          widthMm: Math.round(gap),
          sillMm: kind === "window" ? 900 : 0,
          headMm: kind === "window" ? 2100 : 2100,
          entrance: false,
          provenance: prov,
        } as SpatialModel["openings"][number]);
      }
      reach = Math.max(reach, hi(r));
    }
  }

  // Close the outline: along each edge of the walls' bounding box, add a wall for every stretch with none.
  const extra: Rect[] = [];
  let closedMm = 0;
  if (opts.closeOutline !== false) {
    const edgeT = Math.round(
      [...walls]
        .filter((w) => w.kind === "exterior")
        .map((w) => w.thicknessMm)
        .sort((a, b) => a - b)[0] ?? 200,
    );
    const covered = (horizontal: boolean, at: number) =>
      rects
        .filter((r) => (horizontal ? r[2] - r[0] >= r[3] - r[1] : r[3] - r[1] > r[2] - r[0]))
        .filter((r) => {
          const c = horizontal ? (r[1] + r[3]) / 2 : (r[0] + r[2]) / 2;
          return Math.abs(c - at) <= thickness(r) / 2 + tol + 1;
        })
        .map((r) =>
          horizontal ? ([r[0], r[2]] as [number, number]) : ([r[1], r[3]] as [number, number]),
        )
        .sort((a, b) => a[0] - b[0]);
    const edges: { horizontal: boolean; at: number; lo: number; hi: number }[] = [
      { horizontal: true, at: by0 + edgeT / 2, lo: bx0, hi: bx1 },
      { horizontal: true, at: by1 - edgeT / 2, lo: bx0, hi: bx1 },
      { horizontal: false, at: bx0 + edgeT / 2, lo: by0, hi: by1 },
      { horizontal: false, at: bx1 - edgeT / 2, lo: by0, hi: by1 },
    ];
    for (const e of edges) {
      let at = e.lo;
      const gaps: [number, number][] = [];
      for (const [a, b] of covered(e.horizontal, e.at)) {
        if (a > at + 300) gaps.push([at, a]);
        at = Math.max(at, b);
      }
      if (e.hi > at + 300) gaps.push([at, e.hi]);
      for (const [a, b] of gaps) {
        const id = `w${++n}`;
        walls.push({
          id,
          levelId: "L1",
          a: e.horizontal
            ? { x: Math.round(a), y: Math.round(e.at) }
            : { x: Math.round(e.at), y: Math.round(a) },
          b: e.horizontal
            ? { x: Math.round(b), y: Math.round(e.at) }
            : { x: Math.round(e.at), y: Math.round(b) },
          thicknessMm: edgeT,
          kind: "exterior",
          structural: "unknown",
          glazed: false,
          provenance: {
            source: "inferred",
            toleranceMm: tol,
            confidence: 0.3,
            evidence: prov.evidence,
          },
        });
        extra.push(
          e.horizontal
            ? [a, e.at - edgeT / 2, b, e.at + edgeT / 2]
            : [e.at - edgeT / 2, a, e.at + edgeT / 2, b],
        );
        closedMm += b - a;
      }
    }
    if (closedMm > 0)
      assumptions.push(
        `${Math.round(closedMm / 1000)} m of outer wall was added where the sheet draws no wall along the outline (marked inferred)`,
      );
  }

  // Rooms: flood the free space around each label on a grid of the walls, closing doorways by growing the walls.
  const gx = Math.ceil((bx1 - bx0) / CELL) + 2;
  const gy = Math.ceil((by1 - by0) / CELL) + 2;
  const wall = new Uint8Array(gx * gy);
  const cellOf = (x: number, y: number) =>
    [Math.floor((x - bx0) / CELL) + 1, Math.floor((y - by0) / CELL) + 1] as const;
  for (const r of [...rects, ...extra]) {
    const [x0, y0] = cellOf(r[0], r[1]);
    const [x1, y1] = cellOf(r[2] - 1, r[3] - 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) wall[y * gx + x] = 1;
  }
  // The outer ring of the grid and everything outside the walls' bounding box is closed by construction.
  for (let x = 0; x < gx; x++) {
    wall[x] = 1;
    wall[(gy - 1) * gx + x] = 1;
  }
  for (let y = 0; y < gy; y++) {
    wall[y * gx] = 1;
    wall[y * gx + gx - 1] = 1;
  }
  const grow = (src: Uint8Array, r: number) => {
    if (r === 0) return src;
    const pass = (s: Uint8Array, horizontal: boolean) => {
      const out = new Uint8Array(s.length);
      const outer = horizontal ? gy : gx;
      const inner = horizontal ? gx : gy;
      for (let o = 0; o < outer; o++) {
        const at = (i: number) => (horizontal ? o * gx + i : i * gx + o);
        let count = 0;
        for (let i = 0; i < Math.min(inner, r); i++) count += s[at(i)] as number;
        for (let i = 0; i < inner; i++) {
          if (i + r < inner) count += s[at(i + r)] as number;
          if (i - r - 1 >= 0) count -= s[at(i - r - 1)] as number;
          out[at(i)] = count > 0 ? 1 : 0;
        }
      }
      return out;
    };
    return pass(pass(src, true), false);
  };
  const ladder = [0, 150, 300, 450, 600, 800].map((mm) => Math.round(mm / CELL));
  const grids = new Map<number, Uint8Array>();
  const labels = evidence.labels.filter((l) => l.role === "room");
  const found: { name: string; cells: number[]; r: number }[] = [];
  const unplaced: string[] = [];
  const buildingCells = gx * gy;
  for (const label of labels) {
    const [sx, sy] = cellOf(label.at[0], label.at[1]);
    if (sx < 1 || sy < 1 || sx >= gx - 1 || sy >= gy - 1) {
      unplaced.push(label.text);
      continue;
    }
    let placed = false;
    for (const r of ladder) {
      let g = grids.get(r);
      if (!g) {
        g = grow(wall, r);
        grids.set(r, g);
      }
      if (g[sy * gx + sx]) continue;
      const seen = new Set<number>([sy * gx + sx]);
      const stack = [sy * gx + sx];
      let leaked = false;
      let x0 = sx;
      let x1 = sx;
      let y0 = sy;
      let y1 = sy;
      while (stack.length && !leaked) {
        const i = stack.pop() as number;
        const x = i % gx;
        const y = (i - x) / gx;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
        if (seen.size > buildingCells * 0.3) leaked = true;
        for (const j of [i - 1, i + 1, i - gx, i + gx]) {
          if (!g[j] && !seen.has(j)) {
            seen.add(j);
            stack.push(j);
          }
        }
      }
      // Accept a bounded, compact space: it fills most of its own bounding box.
      if (!leaked && seen.size / ((x1 - x0 + 1) * (y1 - y0 + 1)) >= 0.8 && seen.size >= 400 / 1) {
        found.push({ name: label.text, cells: [...seen], r });
        placed = true;
        break;
      }
    }
    if (!placed) unplaced.push(label.text);
  }
  // Each free cell within the growth distance of a room's core goes to the nearest room, so shrunken cores recover the
  // width their doorways took and no two rooms share floor.
  const owner = new Int32Array(gx * gy).fill(-1);
  const dist = new Int32Array(gx * gy).fill(-1);
  const queue: number[] = [];
  found.forEach((f, k) => {
    for (const c of f.cells) {
      owner[c] = k;
      dist[c] = 0;
      queue.push(c);
    }
  });
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number;
    const k = owner[i] as number;
    const limit = (found[k] as { r: number }).r;
    if ((dist[i] as number) >= limit) continue;
    for (const j of [i - 1, i + 1, i - gx, i + gx]) {
      if (!wall[j] && owner[j] === -1) {
        owner[j] = k;
        dist[j] = (dist[i] as number) + 1;
        queue.push(j);
      }
    }
  }
  const spaces: SpatialModel["spaces"] = [];
  found.forEach((f, k) => {
    const cells: number[] = [];
    for (let i = 0; i < owner.length; i++) if (owner[i] === k) cells.push(i);
    const ring = outline(cells, gx, bx0, by0);
    if (!ring) {
      unplaced.push(f.name);
      return;
    }
    spaces.push({
      id: `s${spaces.length + 1}`,
      levelId: "L1",
      kind: kindFromName(f.name),
      name: f.name,
      boundary: { outer: ring, holes: [] },
      programme: {},
      locked: false,
      provenance: { ...prov, toleranceMm: tol + 2 * CELL },
    });
  });
  if (unplaced.length)
    assumptions.push(
      `${unplaced.length} labelled room(s) are not closed by the drawn walls and were left out`,
    );

  const level = [
    { x: bx0, y: by0 },
    { x: bx1, y: by0 },
    { x: bx1, y: by1 },
    { x: bx0, y: by1 },
  ];
  const model: SpatialModel = {
    schema: SCHEMA_VERSION,
    units: "mm",
    name: opts.name ?? evidence.source,
    northDeg: 0,
    levels: [
      {
        id: "L1",
        name: "Level 1",
        elevationMm: 0,
        heightMm: opts.levelHeightMm ?? 3000,
        boundary: { outer: level, holes: [] },
        provenance: {
          source: "inferred",
          toleranceMm: tol,
          confidence: 0.5,
          evidence: prov.evidence,
        },
      },
    ],
    spaces,
    walls,
    openings,
    obstacles: [],
    connectors: [],
    items: [],
  };
  return {
    model,
    report: {
      walls: walls.length,
      closedMm: Math.round(closedMm),
      openings: openings.length,
      spaces: spaces.length,
      unplaced,
      assumptions,
    },
  };
}

/** The outer boundary of a set of grid cells as a counter-clockwise ring in millimetres, or undefined if it is not one loop. */
function outline(
  cells: number[],
  gx: number,
  ox: number,
  oy: number,
): { x: number; y: number }[] | undefined {
  const inSet = new Set(cells);
  const edges = new Map<string, [number, number]>();
  const corner = (x: number, y: number) => `${x},${y}`;
  for (const i of cells) {
    const x = i % gx;
    const y = (i - x) / gx;
    // Directed so the cell is on the left walking in +x then +y (positive shoelace in x east, y south numbers).
    if (!inSet.has(i - gx)) edges.set(corner(x, y), [x + 1, y]);
    if (!inSet.has(i + 1)) edges.set(corner(x + 1, y), [x + 1, y + 1]);
    if (!inSet.has(i + gx)) edges.set(corner(x + 1, y + 1), [x, y + 1]);
    if (!inSet.has(i - 1)) edges.set(corner(x, y + 1), [x, y]);
  }
  if (!edges.size) return undefined;
  const first = edges.keys().next().value as string;
  const ring: [number, number][] = [];
  let at = first;
  for (let guard = 0; guard <= edges.size + 1; guard++) {
    const [x, y] = at.split(",").map(Number) as [number, number];
    ring.push([x, y]);
    const next = edges.get(at);
    if (!next) return undefined;
    at = corner(next[0], next[1]);
    if (at === first) break;
  }
  if (at !== first || ring.length < 4) return undefined;
  // Drop points that lie on a straight line.
  const simple = ring.filter((p, i) => {
    const a = ring[(i + ring.length - 1) % ring.length] as [number, number];
    const b = ring[(i + 1) % ring.length] as [number, number];
    return (a[0] - p[0]) * (b[1] - p[1]) - (a[1] - p[1]) * (b[0] - p[0]) !== 0;
  });
  if (simple.length < 3) return undefined;
  const mm = simple.map(([x, y]) => ({ x: ox + (x - 1) * CELL, y: oy + (y - 1) * CELL }));
  let area = 0;
  for (let i = 0; i < mm.length; i++) {
    const p = mm[i] as { x: number; y: number };
    const q = mm[(i + 1) % mm.length] as { x: number; y: number };
    area += p.x * q.y - q.x * p.y;
  }
  return area > 0 ? mm : mm.reverse();
}
