// Spike: does the existing row engine, run in two stacked zones that share the entrance lobby,
// produce good plans for an L-shaped floor? Prototype only: nothing in packages/ changes.
// Run: pnpm exec vitest run research/spikes/notched/notched.test.ts   (from the repo root)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { KIND_RULES } from "../../../packages/core/src/catalog";
import { type CostContext, planCost } from "../../../packages/core/src/layout/cost";
import { fitWidths, type Realized } from "../../../packages/core/src/layout/realize";
import { CORRIDOR_WIDTH_M, LOBBY_WIDTH_M } from "../../../packages/core/src/layout/types";
import type { PlannedRoom } from "../../../packages/core/src/program";

interface Rect { x: number; y: number; w: number; h: number }
const problems = JSON.parse(readFileSync("research/results/problems.json", "utf8")).problems;

/** Rows are numbered from the north. The notch is the north-east corner: width nw, height nh. */
function realizeNotched(rows: string[][], rooms: Map<string, PlannedRoom>, W: number, D: number, notch: { w: number; h: number }): Realized & { topRows: number } {
  const k = rows.length;
  const target = (row: string[]) => row.reduce((s, id) => s + (rooms.get(id)?.targetAreaM2 ?? 0), 0);
  const totals = rows.map(target);
  const total = totals.reduce((a, b) => a + b, 0);
  // The zone split is a function of the rows and their targets only, so it can be recomputed.
  const topCap = (W - notch.w - LOBBY_WIDTH_M) * notch.h;
  const botCap = (W - LOBBY_WIDTH_M) * (D - notch.h);
  const share = topCap / (topCap + botCap);
  let top = 1;
  let bestGap = Infinity;
  for (let s = 1; s <= k - 1; s++) {
    const gap = Math.abs(totals.slice(0, s).reduce((a, b) => a + b, 0) / total - share);
    if (gap < bestGap) { bestGap = gap; top = s; }
  }
  const rects = new Map<string, Rect>();
  const rowY: number[] = [];
  const rowDepth: number[] = [];
  const corridors: Rect[] = [];
  let crowded = false;
  const placeZone = (idx: number[], y0: number, height: number, avail: number, boundaryCorridorAbove: boolean) => {
    const inner = idx.length - 1;
    const depthTotal = height - inner * CORRIDOR_WIDTH_M;
    const t = idx.reduce((s, i) => s + (totals[i] ?? 0), 0);
    let y = y0;
    idx.forEach((i, n) => {
      const depth = (depthTotal * (totals[i] ?? 0)) / t;
      rowY[i] = y;
      rowDepth[i] = depth;
      const row = rows[i] as string[];
      const widths = fitWidths(row.map((id) => rooms.get(id)?.targetAreaM2 ?? 0), row.map((id) => KIND_RULES[rooms.get(id)?.kind ?? "storage"].minWidth), avail);
      if (widths.crowded) crowded = true;
      let x = LOBBY_WIDTH_M;
      row.forEach((id, j) => { const w = widths.values[j] ?? 0; rects.set(id, { x, y, w, h: depth }); x += w; });
      y += depth;
      if (n < idx.length - 1) { corridors.push({ x: LOBBY_WIDTH_M, y, w: avail, h: CORRIDOR_WIDTH_M }); y += CORRIDOR_WIDTH_M; }
    });
    void boundaryCorridorAbove;
  };
  const topIdx = rows.slice(0, top).map((_, i) => i);
  const botIdx = rows.slice(top).map((_, i) => top + i);
  placeZone(topIdx, 0, notch.h, W - notch.w - LOBBY_WIDTH_M, false);
  // one corridor along the foot of the notch serves the last top row and the first bottom row
  corridors.push({ x: LOBBY_WIDTH_M, y: notch.h, w: W - LOBBY_WIDTH_M, h: CORRIDOR_WIDTH_M });
  placeZone(botIdx, notch.h + CORRIDOR_WIDTH_M, D - notch.h - CORRIDOR_WIDTH_M, W - LOBBY_WIDTH_M, true);
  return { rects, rowY, rowDepth, corridors, lobby: { x: 0, y: 0, w: LOBBY_WIDTH_M, h: D }, scale: 1, crowded, topRows: top };
}

let s = 1;
const rnd = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };

function anneal(ctx: CostContext, notch: { w: number; h: number }, k: number, seed: number, iters: number) {
  s = seed;
  const ids = [...ctx.rooms.keys()];
  const sorted = [...ids].sort((a, b) => (ctx.rooms.get(b)?.targetAreaM2 ?? 0) - (ctx.rooms.get(a)?.targetAreaM2 ?? 0));
  let rows: string[][] = Array.from({ length: k }, () => []);
  const load = new Array(k).fill(0);
  for (const id of sorted.sort(() => rnd() - 0.5).sort((a, b) => (ctx.rooms.get(b)?.targetAreaM2 ?? 0) - (ctx.rooms.get(a)?.targetAreaM2 ?? 0))) {
    const b = load.indexOf(Math.min(...load)); rows[b]?.push(id); load[b] += ctx.rooms.get(id)?.targetAreaM2 ?? 0;
  }
  for (const r of rows) r.sort(() => rnd() - 0.5);
  const cost = (r: string[][]) => planCost(realizeNotched(r, ctx.rooms, ctx.W, ctx.D, notch), ctx).total;
  let cur = cost(rows);
  let best = { rows, cost: cur };
  for (let step = 0; step < iters; step++) {
    const T = 4 * (1 - step / iters) ** 2 + 0.02;
    const next = rows.map((r) => [...r]);
    const m = rnd();
    const pick = () => { const r = Math.floor(rnd() * k); return { r, i: Math.floor(rnd() * (next[r]?.length ?? 1)) }; };
    if (m < 0.5) { const a = pick(), b = pick(); const ra = next[a.r], rb = next[b.r]; if (!ra || !rb || ra[a.i] === undefined || rb[b.i] === undefined) continue; [ra[a.i], rb[b.i]] = [rb[b.i] as string, ra[a.i] as string]; }
    else if (m < 0.9) { const f = pick(); const src = next[f.r]; if (!src || src.length < 2) continue; const [id] = src.splice(f.i, 1); const to = next[Math.floor(rnd() * k)]; if (!to || id === undefined) continue; to.splice(Math.floor(rnd() * (to.length + 1)), 0, id); }
    else { const r = next[Math.floor(rnd() * k)]; if (!r || r.length < 2) continue; r.reverse(); }
    const c = cost(next);
    if (c <= cur || rnd() < Math.exp(-(c - cur) / T)) { rows = next; cur = c; if (c < best.cost) best = { rows: next.map((r) => [...r]), cost: c }; }
  }
  return best;
}

describe("notched layout spike", () => {
  it("lays out every west-entrance brief in an L of the same floor area", { timeout: 900_000 }, () => {
    const out: Record<string, unknown> = {};
    for (const p of problems.filter((x: { shell: { entrance: string } }) => x.shell.entrance === "west")) {
      const f = 1 / Math.sqrt(1 - 0.35 * 0.4);
      const W = Math.round(p.shell.widthM * f * 10) / 10;
      const D = Math.round(p.shell.depthM * f * 10) / 10;
      const notch = { w: Math.round(0.35 * W * 10) / 10, h: Math.round(0.4 * D * 10) / 10 };
      const rooms = new Map<string, PlannedRoom>(p.rooms.map((r: { id: string; kind: PlannedRoom["kind"]; name: string; targetAreaM2: number }) => [r.id, { id: r.id, kind: r.kind, name: r.name, targetAreaM2: r.targetAreaM2, basis: "" }]));
      const ctx: CostContext = { rooms, W, D, windows: p.shell.windows };
      let best: { rows: string[][]; cost: number } | undefined;
      const t0 = performance.now();
      for (const k of [2, 3]) for (let r = 0; r < 4; r++) { const res = anneal(ctx, notch, k, 1000 * k + r + 1, 4000); if (!best || res.cost < best.cost) best = res; }
      const ms = Math.round(performance.now() - t0);
      if (!best) continue;
      const real = realizeNotched(best.rows, rooms, W, D, notch);
      out[p.name] = {
        W, D, notch, rows: best.rows, cost: best.cost, ms, topRows: real.topRows, windows: p.shell.windows,
        rooms: [...real.rects].map(([id, rect]) => ({ id, kind: rooms.get(id)?.kind, rect })),
        corridors: real.corridors, lobby: real.lobby,
      };
    }
    mkdirSync("research/results", { recursive: true });
    writeFileSync("research/results/notched-plans.json", JSON.stringify(out, null, 1));
  });
});
