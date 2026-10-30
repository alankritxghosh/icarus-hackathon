// Turns what a vector PDF drawing contains into the evidence `auditAgainstDrawing` needs: the filled shapes the
// sheet uses for walls and structure, and the room labels with the sizes printed under them. Nothing here looks at
// pixels or asks a model to read the picture: it reads the drawing's own shapes and text, so a wall is where the
// file puts it to within the file's own precision.
//
// Input is the two plain-text views poppler produces (`pdftocairo -svg` and `pdftotext -bbox-layout`), so this file is
// pure and runs in a browser or a worker; `pdfEvidenceNode.ts` shells out to poppler.
//
// What it assumes, and reports whenever it has to guess:
//  - walls are filled rectangles, all in one fill colour (given, or the thin-rectangle colour with the most area);
//  - the sheet is drawn to a known scale (`unitMm`, millimetres per PDF unit, given by the caller);
//  - only axis-aligned rectangles are read. Slanted walls, curves and hatched or hollow outlines are counted and
//    reported as dropped, never silently turned into walls;
//  - a room label lies inside the building's wall bounds; text outside (title block, notes) is ignored.
// A scan or photograph has no shapes to read and yields no walls: that is an error, not an empty pass.
import type { DrawingEvidence, DrawingLabel, Rect } from "./drawingAudit";

export type Rgb = readonly [number, number, number];

export interface ExtractOptions {
  /** Millimetres per PDF unit (1 unit = 1/72 inch on paper). A sheet at 1:100 is `unitMmFromScale(100)`. */
  unitMm: number;
  /** Fill colours (0-255) that mean walls. Omitted: the colour of the thin rectangles with the most area. */
  wallColours?: Rgb[];
  /** Fill colours that mean structure only (columns, cores). */
  supportColours?: Rgb[];
  /** Per-channel colour tolerance, 0-255. Default 8. */
  colourTolerance?: number;
  /** Thinnest filled rectangle that counts as a wall, millimetres. Default 40. */
  minThicknessMm?: number;
  /** Label text to ignore (title block words). Defaults to common sheet furniture. */
  ignoreLabels?: RegExp[];
  /** Move everything so the walls' bounding box starts at 0, 0. Default true. */
  originAtWalls?: boolean;
}

export interface ExtractionReport {
  wallColour: Rgb;
  assumptions: string[];
  rectsRead: number;
  /** Shapes that were not read as walls, with why, so a reader can see what the audit never had a chance to check. */
  dropped: {
    notRectangle: number;
    hollow: number;
    tooThin: number;
    otherColour: number;
    duplicates: number;
  };
  labelsIgnored: string[];
  /** Added to every coordinate of the sheet to reach the evidence's frame, millimetres. */
  offsetMm: [number, number];
}

export interface ExtractedEvidence {
  evidence: DrawingEvidence;
  report: ExtractionReport;
}

/** Millimetres per PDF unit for a sheet printed at 1:`ratio` (a PDF unit is 1/72 inch). */
export const unitMmFromScale = (ratio: number): number => (25.4 / 72) * ratio;

// ---- SVG ----

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (m: Matrix, n: Matrix): Matrix => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

function parseTransform(value: string | undefined): Matrix {
  if (!value) return IDENTITY;
  let m = IDENTITY;
  for (const t of value.matchAll(/(matrix|translate|scale)\(([^)]*)\)/g)) {
    const n = (t[2] ?? "")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    const a = n[0] ?? 0;
    const b = n[1] ?? 0;
    if (t[1] === "matrix" && n.length === 6) m = multiply(m, n as unknown as Matrix);
    else if (t[1] === "translate") m = multiply(m, [1, 0, 0, 1, a, n.length > 1 ? b : 0]);
    else if (t[1] === "scale") m = multiply(m, [a, 0, 0, n.length > 1 ? b : a, 0, 0]);
  }
  return m;
}

function attrs(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of source.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g))
    out[a[1] as string] = a[2] as string;
  return out;
}

export function parseColour(value: string | undefined): Rgb | undefined {
  if (!value || value === "none") return undefined;
  const hex = /^#([0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const n = Number.parseInt(hex[1] as string, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgb\(\s*([\d.]+)(%?)\s*,\s*([\d.]+)%?\s*,\s*([\d.]+)%?\s*\)$/.exec(value);
  if (!rgb) return undefined;
  const k = rgb[2] ? 2.55 : 1;
  return [Number(rgb[1]) * k, Number(rgb[3]) * k, Number(rgb[4]) * k].map(
    Math.round,
  ) as unknown as Rgb;
}

type Pt = [number, number];

/** The closed subpaths of a path's `d`, as point lists; undefined if the path uses curves or arcs. */
function subpaths(d: string): Pt[][] | undefined {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let x = 0;
  let y = 0;
  const flush = () => {
    // A lone moveto (poppler ends every shape with one) draws nothing.
    if (cur.length >= 3) out.push(cur);
    cur = [];
  };
  for (const seg of d.matchAll(/([MmLlHhVvZzCcSsQqTtAa])([^MmLlHhVvZzCcSsQqTtAa]*)/g)) {
    const c = seg[1] as string;
    const n = (seg[2] ?? "")
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    if (/[CcSsQqTtAa]/.test(c)) return undefined;
    if (c === "Z" || c === "z") {
      flush();
      continue;
    }
    const rel = c === c.toLowerCase();
    const k = c.toUpperCase();
    if (k === "M" || k === "L") {
      for (let i = 0; i + 1 < n.length; i += 2) {
        if (k === "M" && i === 0) flush();
        x = (rel ? x : 0) + (n[i] as number);
        y = (rel ? y : 0) + (n[i + 1] as number);
        cur.push([x, y]);
      }
    } else if (k === "H") {
      x = (rel ? x : 0) + (n[n.length - 1] as number);
      cur.push([x, y]);
    } else if (k === "V") {
      y = (rel ? y : 0) + (n[n.length - 1] as number);
      cur.push([x, y]);
    }
  }
  flush();
  return out;
}

const EPS = 0.02;

/** [x0, y0, x1, y1] if the points are the corners of an axis-aligned rectangle. */
function asRect(points: Pt[]): Rect | undefined {
  const p =
    points.length === 5 && near(points[0] as Pt, points[4] as Pt) ? points.slice(0, 4) : points;
  if (p.length !== 4) return undefined;
  const xs = [...new Set(p.map((q) => Math.round(q[0] / EPS)))];
  const ys = [...new Set(p.map((q) => Math.round(q[1] / EPS)))];
  if (xs.length !== 2 || ys.length !== 2) return undefined;
  for (let i = 0; i < 4; i++) {
    const a = p[i] as Pt;
    const b = p[(i + 1) % 4] as Pt;
    if (Math.abs(a[0] - b[0]) > EPS && Math.abs(a[1] - b[1]) > EPS) return undefined;
  }
  const x = p.map((q) => q[0]);
  const y = p.map((q) => q[1]);
  return [Math.min(...x), Math.min(...y), Math.max(...x), Math.max(...y)];
}
const near = (a: Pt, b: Pt) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
const inside = (a: Rect, b: Rect) => a[0] >= b[0] && a[1] >= b[1] && a[2] <= b[2] && a[3] <= b[3];

/**
 * The rectangles a path's subpaths make. CAD plots often draw a solid fill as triangles (two to a rectangle), so
 * triangles that share corners are grouped and read as a rectangle when together they exactly fill their bounding
 * box. `bad` counts the subpaths that are neither.
 */
function rectsOf(subs: Pt[][]): { rects: Rect[]; bad: number } {
  const rects: Rect[] = [];
  let bad = 0;
  const tris: Pt[][] = [];
  for (const pts of subs) {
    const r = asRect(pts);
    if (r) rects.push(r);
    else if (pts.length === 3) tris.push(pts);
    else bad++;
  }
  const key = (q: Pt) => `${Math.round(q[0] / 0.05)},${Math.round(q[1] / 0.05)}`;
  const parent = tris.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while ((parent[root] as number) !== root) root = parent[root] as number;
    parent[i] = root;
    return root;
  };
  const owner = new Map<string, number>();
  tris.forEach((t, i) => {
    for (const q of t) {
      const o = owner.get(key(q));
      if (o === undefined) owner.set(key(q), i);
      else parent[find(i)] = find(o);
    }
  });
  const groups = new Map<number, Pt[][]>();
  tris.forEach((t, i) => {
    const root = find(i);
    groups.set(root, [...(groups.get(root) ?? []), t]);
  });
  for (const g of groups.values()) {
    const cells = rectilinearCells(g);
    if (cells) rects.push(...cells);
    else bad += g.length;
  }
  return { rects, bad };
}

const triArea = (t: Pt[]) =>
  Math.abs(
    ((t[1] as Pt)[0] - (t[0] as Pt)[0]) * ((t[2] as Pt)[1] - (t[0] as Pt)[1]) -
      ((t[2] as Pt)[0] - (t[0] as Pt)[0]) * ((t[1] as Pt)[1] - (t[0] as Pt)[1]),
  ) / 2;

function inTriangle(t: Pt[], x: number, y: number): boolean {
  const [a, b, c] = t as [Pt, Pt, Pt];
  const d = (p: Pt, q: Pt) => (x - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (y - q[1]);
  const d1 = d(a, b);
  const d2 = d(b, c);
  const d3 = d(c, a);
  const e = 1e-6;
  return !((d1 < -e || d2 < -e || d3 < -e) && (d1 > e || d2 > e || d3 > e));
}

/**
 * The rectangles that exactly make up the union of some triangles, when that union has only horizontal and vertical
 * edges (a wall corner or T-junction drawn as one polygon). Undefined if the union is slanted or too intricate.
 */
function rectilinearCells(tris: Pt[][]): Rect[] | undefined {
  const uniq = (vs: number[]) => {
    const out: number[] = [];
    for (const v of [...vs].sort((p, q) => p - q))
      if (!out.length || v - (out[out.length - 1] as number) > EPS) out.push(v);
    return out;
  };
  const xs = uniq(tris.flatMap((t) => t.map((q) => q[0])));
  const ys = uniq(tris.flatMap((t) => t.map((q) => q[1])));
  if (xs.length < 2 || ys.length < 2 || xs.length > 60 || ys.length > 60) return undefined;
  const filled: boolean[][] = [];
  let area = 0;
  for (let j = 0; j + 1 < ys.length; j++) {
    filled.push([]);
    for (let i = 0; i + 1 < xs.length; i++) {
      const cx = ((xs[i] as number) + (xs[i + 1] as number)) / 2;
      const cy = ((ys[j] as number) + (ys[j + 1] as number)) / 2;
      const on = tris.some((t) => inTriangle(t, cx, cy));
      (filled[j] as boolean[]).push(on);
      if (on)
        area +=
          ((xs[i + 1] as number) - (xs[i] as number)) * ((ys[j + 1] as number) - (ys[j] as number));
    }
  }
  const sum = tris.reduce((acc, t) => acc + triArea(t), 0);
  if (area <= 0 || Math.abs(sum - area) / area > 0.01) return undefined;
  // Merge cells into rectangles: runs along each row, then runs stacked over identical columns.
  const out: [number, number, number, number][] = [];
  const open = new Map<string, [number, number, number, number]>();
  for (let j = 0; j + 1 < ys.length; j++) {
    const seen = new Set<string>();
    let i = 0;
    while (i + 1 < xs.length) {
      if (!(filled[j] as boolean[])[i]) {
        i++;
        continue;
      }
      let k = i;
      while (k + 1 < xs.length - 1 && (filled[j] as boolean[])[k + 1]) k++;
      const key = `${i}:${k}`;
      seen.add(key);
      const prev = open.get(key);
      if (prev) prev[3] = ys[j + 1] as number;
      else {
        const r: [number, number, number, number] = [
          xs[i] as number,
          ys[j] as number,
          xs[k + 1] as number,
          ys[j + 1] as number,
        ];
        open.set(key, r);
        out.push(r);
      }
      i = k + 1;
    }
    for (const key of [...open.keys()]) if (!seen.has(key)) open.delete(key);
  }
  return out;
}

interface Filled {
  rect: Rect;
  colour: Rgb;
}

/** Every filled axis-aligned rectangle in an SVG, in PDF units with y down, plus counts of what was not read. */
export function filledRects(svg: string): {
  rects: Filled[];
  notRectangle: number;
  hollow: number;
} {
  const rects: Filled[] = [];
  let notRectangle = 0;
  let hollow = 0;
  const stack: Matrix[] = [IDENTITY];
  let skip = 0;
  for (const tag of svg.matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>/g)) {
    const closing = tag[1] === "/";
    const name = tag[2] as string;
    const selfClosing = tag[4] === "/";
    if (
      name === "defs" ||
      name === "clipPath" ||
      name === "symbol" ||
      name === "mask" ||
      name === "pattern"
    ) {
      if (closing) skip = Math.max(0, skip - 1);
      else if (!selfClosing) skip++;
      continue;
    }
    if (skip) continue;
    if (name === "g") {
      if (closing) {
        if (stack.length > 1) stack.pop();
      } else if (!selfClosing) {
        const a = attrs(tag[3] as string);
        stack.push(multiply(stack[stack.length - 1] as Matrix, parseTransform(a.transform)));
      }
      continue;
    }
    if (name !== "path" || closing) continue;
    const a = attrs(tag[3] as string);
    const colour = parseColour(a.fill);
    if (!colour || !a.d || (a["fill-opacity"] !== undefined && Number(a["fill-opacity"]) < 0.5))
      continue;
    const parts = subpaths(a.d);
    if (!parts) {
      notRectangle++;
      continue;
    }
    const m = multiply(stack[stack.length - 1] as Matrix, parseTransform(a.transform));
    const placed = parts.map((pts) =>
      pts.map(([px, py]) => [m[0] * px + m[2] * py + m[4], m[1] * px + m[3] * py + m[5]] as Pt),
    );
    const { rects: rs, bad } = rectsOf(placed);
    if (bad) {
      notRectangle += bad;
      continue;
    }
    // One shape inside another within a single fill is an outline (a hole), not a solid: read none of it.
    if (rs.some((r, i) => rs.some((s, j) => i !== j && inside(r, s)))) {
      hollow++;
      continue;
    }
    for (const rect of rs) rects.push({ rect, colour });
  }
  return { rects, notRectangle, hollow };
}

// ---- Text ----

const decode = (s: string) =>
  s
    .replace(/[’‘′]/g, "'")
    .replace(/[”“″]/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** Millimetres for a printed size such as 10'2" x 10'0" or 3.2 x 4.1 m, or undefined if the text is not a size. */
export function parsePrintedSize(text: string): [number, number] | undefined {
  const t = decode(text)
    .replace(/^\(|\)$/g, "")
    .trim();
  const ft =
    /^(\d+)\s*['′]\s*-?\s*(\d+(?:\.\d+)?)?\s*(?:["″]|'')?\s*[xX×]\s*(\d+)\s*['′]\s*-?\s*(\d+(?:\.\d+)?)?\s*(?:["″]|'')?$/.exec(
      t,
    );
  if (ft) {
    const mm = (f: string | undefined, i: string | undefined) =>
      (Number(f) * 12 + Number(i ?? 0)) * 25.4;
    return [mm(ft[1], ft[2]), mm(ft[3], ft[4])];
  }
  const metric = /^(\d+(?:\.\d+)?)\s*(mm|m)?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*(mm|m)?$/.exec(t);
  if (metric) {
    const conv = (v: string | undefined, u: string | undefined) => {
      const n = Number(v);
      return u === "mm" ? n : u === "m" || n < 100 ? n * 1000 : n;
    };
    return [conv(metric[1], metric[2]), conv(metric[3], metric[4] ?? metric[2])];
  }
  return undefined;
}

const FEET_INLINE =
  /(\d+)\s*'\s*-?\s*(\d+(?:\.\d+)?)?\s*(?:"|'')?\s*[xX×]\s*(\d+)\s*'\s*-?\s*(\d+(?:\.\d+)?)?\s*(?:"|'')?/;

/** A line of text split into its words and the size printed in it, if any: "BEDROOM 10'0" x 12'0"" gives both. */
export function splitPrintedSize(text: string): { rest: string; size?: [number, number] } {
  const t = decode(text).trim();
  const whole = parsePrintedSize(t);
  if (whole) return { rest: "", size: whole };
  const m = FEET_INLINE.exec(t);
  const size = m ? parsePrintedSize(m[0]) : undefined;
  return m && size
    ? { rest: `${t.slice(0, m.index)} ${t.slice(m.index + m[0].length)}`.trim(), size }
    : { rest: t };
}

interface TextLine {
  text: string;
  box: Rect;
}

function textBlocks(bboxHtml: string): TextLine[][] {
  const blocks: TextLine[][] = [];
  for (const b of bboxHtml.matchAll(/<block\b([^>]*)>([\s\S]*?)<\/block>/g)) {
    const lines: TextLine[] = [];
    for (const l of (b[2] as string).matchAll(/<line\b([^>]*)>([\s\S]*?)<\/line>/g)) {
      const la = attrs(l[1] as string);
      const words = [...(l[2] as string).matchAll(/<word\b[^>]*>([^<]*)<\/word>/g)].map((w) =>
        decode(w[1] as string),
      );
      if (!words.length) continue;
      lines.push({
        text: words.join(" "),
        box: [Number(la.xMin), Number(la.yMin), Number(la.xMax), Number(la.yMax)],
      });
    }
    if (lines.length) blocks.push(lines);
  }
  return blocks;
}

const DEFAULT_IGNORED: RegExp[] = [
  /^level\b/i,
  /\bwide\b/i,
  /\bscale\b/i,
  /\bnorth\b/i,
  /\bdrawing\b/i,
  /\bplan\b/i,
  /\bsheet\b/i,
  /\bnote/i,
  /\bdate\b/i,
];

// ---- Putting it together ----

const close = (a: Rgb, b: Rgb, tol: number) =>
  a.every((v, i) => Math.abs(v - (b[i] as number)) <= tol);

export function extractEvidence(
  svg: string,
  bboxHtml: string,
  source: string,
  opts: ExtractOptions,
): ExtractedEvidence {
  const tol = opts.colourTolerance ?? 8;
  const minThick = opts.minThicknessMm ?? 40;
  const mm = opts.unitMm;
  const assumptions: string[] = [];
  const read = filledRects(svg);
  const dropped = {
    notRectangle: read.notRectangle,
    hollow: read.hollow,
    tooThin: 0,
    otherColour: 0,
    duplicates: 0,
  };

  const sized = read.rects
    .map((f) => ({ colour: f.colour, rect: f.rect.map((v) => v * mm) as unknown as Rect }))
    .filter((f) => {
      const thin = Math.min(f.rect[2] - f.rect[0], f.rect[3] - f.rect[1]) < minThick;
      if (thin) dropped.tooThin++;
      return !thin;
    });

  let wallColours = opts.wallColours;
  let wallColour: Rgb | undefined = wallColours?.[0];
  if (!wallColours) {
    // Walls are long and thin and numerous: pick the colour with most thin-rectangle area.
    const area = new Map<string, { colour: Rgb; area: number; count: number }>();
    for (const f of sized) {
      const w = f.rect[2] - f.rect[0];
      const h = f.rect[3] - f.rect[1];
      if (Math.min(w, h) > 400 || Math.max(w, h) < 3 * Math.min(w, h)) continue;
      const key = f.colour.map((v) => Math.round(v / 4)).join(",");
      const e = area.get(key) ?? { colour: f.colour, area: 0, count: 0 };
      e.area += w * h;
      e.count++;
      area.set(key, e);
    }
    const best = [...area.values()].sort((a, b) => b.area - a.area)[0];
    if (!best || best.count < 4)
      throw new Error(
        "no wall fill found: the PDF has no filled rectangles that look like walls (a scan or photograph cannot be read this way); pass wallColours if the walls are drawn another way",
      );
    wallColour = best.colour;
    wallColours = [best.colour];
    assumptions.push(
      `walls are the fill rgb(${best.colour.join(", ")}): the colour of the most thin rectangles (${best.count}); pass wallColours to override`,
    );
  }
  const supportColours = opts.supportColours ?? [];

  const wallRects: Rect[] = [];
  const supportRects: Rect[] = [];
  const seen = new Set<string>();
  for (const f of sized) {
    const isWall = (wallColours as Rgb[]).some((c) => close(c, f.colour, tol));
    const isSupport = !isWall && supportColours.some((c) => close(c, f.colour, tol));
    if (!isWall && !isSupport) {
      dropped.otherColour++;
      continue;
    }
    const key = f.rect.map((v) => Math.round(v)).join(",");
    if (seen.has(`${isWall}:${key}`)) {
      dropped.duplicates++;
      continue;
    }
    seen.add(`${isWall}:${key}`);
    (isWall ? wallRects : supportRects).push(f.rect);
  }
  if (!wallRects.length) throw new Error("no walls found in the wall fill colour");

  let ox = 0;
  let oy = 0;
  if (opts.originAtWalls !== false) {
    ox = -Math.min(...wallRects.map((r) => r[0]));
    oy = -Math.min(...wallRects.map((r) => r[1]));
    assumptions.push(
      "the building's wall bounds start at 0, 0; shift the evidence to your model's frame before auditing (anchorEvidence)",
    );
  }
  const shift = (r: Rect): Rect => [r[0] + ox, r[1] + oy, r[2] + ox, r[3] + oy];
  const walls = wallRects.map(shift);
  const supports = supportRects.map(shift);
  const bounds = [
    Math.min(...walls.map((r) => r[0])),
    Math.min(...walls.map((r) => r[1])),
    Math.max(...walls.map((r) => r[2])),
    Math.max(...walls.map((r) => r[3])),
  ] as const;

  const ignored = opts.ignoreLabels ?? DEFAULT_IGNORED;
  const labelsIgnored: string[] = [];
  const labels: DrawingLabel[] = [];
  const looseSizes: { at: [number, number]; size: [number, number] }[] = [];
  for (const block of textBlocks(bboxHtml)) {
    const names: TextLine[] = [];
    let printed: [number, number] | undefined;
    for (const line of block) {
      const { rest, size } = splitPrintedSize(line.text);
      if (size) printed = [size[0], size[1]];
      if (rest) names.push({ ...line, text: rest });
    }
    const text = names
      .map((l) => l.text)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text && printed) {
      const bx = block.map((l) => l.box.map((v) => v * mm) as unknown as Rect);
      looseSizes.push({
        at: [
          (Math.min(...bx.map((b) => b[0])) + Math.max(...bx.map((b) => b[2]))) / 2 + ox,
          (Math.min(...bx.map((b) => b[1])) + Math.max(...bx.map((b) => b[3]))) / 2 + oy,
        ],
        size: printed,
      });
      continue;
    }
    if (!text || (text.match(/[A-Za-z]/g) ?? []).length < 3) continue;
    const box = names.map((l) => l.box.map((v) => v * mm) as unknown as Rect);
    const cx = (Math.min(...box.map((b) => b[0])) + Math.max(...box.map((b) => b[2]))) / 2 + ox;
    const cy = (Math.min(...box.map((b) => b[1])) + Math.max(...box.map((b) => b[3]))) / 2 + oy;
    if (
      cx < bounds[0] - 500 ||
      cx > bounds[2] + 500 ||
      cy < bounds[1] - 500 ||
      cy > bounds[3] + 500
    ) {
      labelsIgnored.push(`${text} (outside the walls)`);
      continue;
    }
    if (ignored.some((r) => r.test(text))) {
      labelsIgnored.push(`${text} (sheet text)`);
      continue;
    }
    labels.push({
      text,
      at: [Math.round(cx), Math.round(cy)],
      role: "room",
      ...(printed
        ? { printedSizeMm: [Math.round(printed[0]), Math.round(printed[1])] as const }
        : {}),
    });
  }

  // A size printed in a block of its own belongs to the nearest room label just above it.
  for (const loose of looseSizes) {
    let best: { label: DrawingLabel; d: number } | undefined;
    for (const label of labels) {
      if (label.printedSizeMm) continue;
      const dx = Math.abs(label.at[0] - loose.at[0]);
      const dy = loose.at[1] - label.at[1];
      const d = Math.hypot(dx, dy);
      if (dx < 1500 && dy > -300 && dy < 1800 && (!best || d < best.d)) best = { label, d };
    }
    if (best)
      (best.label as { printedSizeMm?: readonly [number, number] }).printedSizeMm = [
        Math.round(loose.size[0]),
        Math.round(loose.size[1]),
      ];
  }

  const round = (r: Rect): Rect => [
    Math.round(r[0]),
    Math.round(r[1]),
    Math.round(r[2]),
    Math.round(r[3]),
  ];
  return {
    evidence: {
      schema: "icarus.drawing-evidence/0.1",
      source,
      wallRects: walls.map(round),
      supportRects: supports.map(round),
      labels,
    },
    report: {
      wallColour: wallColour as Rgb,
      assumptions,
      rectsRead: read.rects.length,
      dropped,
      labelsIgnored,
      offsetMm: [Math.round(ox), Math.round(oy)],
    },
  };
}

/** Slides evidence by whole millimetres, for lining a sheet's frame up with a model's. */
export function anchorEvidence(evidence: DrawingEvidence, dx: number, dy: number): DrawingEvidence {
  const r = (v: Rect): Rect => [v[0] + dx, v[1] + dy, v[2] + dx, v[3] + dy];
  return {
    ...evidence,
    wallRects: evidence.wallRects.map(r),
    supportRects: evidence.supportRects.map(r),
    labels: evidence.labels.map((l) => ({ ...l, at: [l.at[0] + dx, l.at[1] + dy] as const })),
  };
}
