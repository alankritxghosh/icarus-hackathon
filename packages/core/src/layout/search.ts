import { KIND_RULES } from "../catalog";
import type { PlannedRoom } from "../program";
import { type CostBreakdown, type CostContext, planCost } from "./cost";
import { realize } from "./realize";

/** A small deterministic generator, so a seed always reproduces a plan. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SearchResult {
  rows: string[][];
  cost: CostBreakdown;
}

const evaluate = (rows: string[][], ctx: CostContext) =>
  planCost(realize(rows, ctx.rooms, ctx.W, ctx.D), ctx);

function initial(
  ids: string[],
  rooms: Map<string, PlannedRoom>,
  k: number,
  random: () => number,
): string[][] {
  const shuffled = [...ids].sort(() => random() - 0.5);
  const rows: string[][] = Array.from({ length: k }, () => []);
  const load = new Array<number>(k).fill(0);
  // Biggest first into the lightest row keeps row areas balanced; order within a row is random.
  for (const id of shuffled.sort(
    (a, b) => (rooms.get(b)?.targetAreaM2 ?? 0) - (rooms.get(a)?.targetAreaM2 ?? 0),
  )) {
    let best = 0;
    for (let i = 1; i < k; i++) if ((load[i] ?? 0) < (load[best] ?? 0)) best = i;
    rows[best]?.push(id);
    load[best] = (load[best] ?? 0) + (rooms.get(id)?.targetAreaM2 ?? 0);
  }
  for (const row of rows) row.sort(() => random() - 0.5);
  return rows;
}

function neighbour(rows: string[][], random: () => number): string[][] | undefined {
  const next = rows.map((row) => [...row]);
  const pick = () => {
    const r = Math.floor(random() * next.length);
    const row = next[r] ?? [];
    return { r, i: Math.floor(random() * row.length) };
  };
  const move = random();
  if (move < 0.45) {
    const a = pick();
    const b = pick();
    const ra = next[a.r];
    const rb = next[b.r];
    if (!ra || !rb || ra[a.i] === undefined || rb[b.i] === undefined) return undefined;
    [ra[a.i], rb[b.i]] = [rb[b.i] as string, ra[a.i] as string];
  } else if (move < 0.85) {
    const from = pick();
    const source = next[from.r];
    if (!source || source.length < 2) return undefined;
    const [id] = source.splice(from.i, 1);
    const to = next[Math.floor(random() * next.length)];
    if (!to || id === undefined) return undefined;
    to.splice(Math.floor(random() * (to.length + 1)), 0, id);
  } else if (move < 0.95) {
    const r = next[Math.floor(random() * next.length)];
    if (!r || r.length < 2) return undefined;
    r.reverse();
  } else {
    const i = Math.floor(random() * (next.length - 1));
    const a = next[i];
    const b = next[i + 1];
    if (!a || !b) return undefined;
    next[i] = b;
    next[i + 1] = a;
  }
  return next;
}

/** Simulated annealing over room orderings for a fixed number of rows. */
function anneal(ctx: CostContext, k: number, seed: number, iterations: number): SearchResult {
  const random = rng(seed);
  const ids = [...ctx.rooms.keys()];
  let rows = initial(ids, ctx.rooms, k, random);
  let cost = evaluate(rows, ctx);
  let best = { rows, cost };
  for (let step = 0; step < iterations; step++) {
    const temperature = 4 * (1 - step / iterations) ** 2 + 0.02;
    const candidate = neighbour(rows, random);
    if (!candidate) continue;
    const next = evaluate(candidate, ctx);
    const delta = next.total - cost.total;
    if (delta <= 0 || random() < Math.exp(-delta / temperature)) {
      rows = candidate;
      cost = next;
      if (cost.total < best.cost.total) best = { rows, cost };
    }
  }
  return { rows: best.rows.map((r) => [...r]), cost: best.cost };
}

export interface SearchOptions {
  seed: number;
  iterations?: number;
  restarts?: number;
}

/** Try two and three rows with several restarts each and keep the lowest-cost plan. */
export function searchLayout(ctx: CostContext, options: SearchOptions): SearchResult {
  const iterations = options.iterations ?? 7000;
  const restarts = options.restarts ?? 5;
  const maxRows = ctx.D >= 11 && ctx.rooms.size >= 8 ? 3 : 2;
  let best: SearchResult | undefined;
  for (let k = 2; k <= maxRows; k++)
    for (let r = 0; r < restarts; r++) {
      const result = anneal(ctx, k, options.seed * 1000 + k * 100 + r, iterations);
      if (!best || result.cost.total < best.cost.total) best = result;
    }
  if (!best) throw new Error("no layout found");
  return best;
}

/** Rooms that must not be empty-rowed or lost: a guard used by tests and the planner. */
export const sameRooms = (rows: string[][], rooms: Map<string, PlannedRoom>) =>
  rows.flat().sort().join() === [...rooms.keys()].sort().join();

export const rulesFor = (room: PlannedRoom) => KIND_RULES[room.kind];
