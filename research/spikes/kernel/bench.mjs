// Geometry-kernel spike: correctness against analytic answers, robustness on degenerate input,
// offsetting, and speed, for three libraries behind one interface. All coordinates are integer mm.
import { writeFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { loadAll, regionArea, resultArea, polyCount, ringCount } from "./libs.mjs";

const require = createRequire(import.meta.url);
const t0 = performance.now();
const libs = await loadAll();
const loadMs = performance.now() - t0;

let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const rect = (x, y, w, h) => [[[x, y], [x + w, y], [x + w, y + h], [x, y + h]]]; // CCW
const R = (x, y, w, h) => [rect(x, y, w, h)];
const L = [[[0, 0], [10000, 0], [10000, 4000], [4000, 4000], [4000, 8000], [0, 8000]]];
const safe = (fn) => { try { return { ok: true, v: fn() }; } catch (e) { return { ok: false, err: String(e.message || e).slice(0, 80) }; } };

const results = { generated: new Date().toISOString(), node: process.version, libs: libs.map(({ name, version, license }) => ({ name, version, license })), loadMs: Math.round(loadMs), tests: {} };
const T = (name, fn) => { results.tests[name] = Object.fromEntries(libs.map((l) => [l.name, fn(l)])); };

// T1: random rectangle pairs against the analytic overlap.
{
  const pairs = Array.from({ length: 3000 }, () => {
    const a = [ri(0, 15000), ri(0, 15000), ri(500, 8000), ri(500, 8000)];
    const b = [ri(0, 15000), ri(0, 15000), ri(500, 8000), ri(500, 8000)];
    return [a, b];
  });
  T("T1 random rectangle pairs (3000): worst area error in mm2", (l) => {
    let worst = 0, fail = 0;
    for (const [a, b] of pairs) {
      const ow = Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - Math.max(a[0], b[0]));
      const oh = Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - Math.max(a[1], b[1]));
      const inter = ow * oh, uni = a[2] * a[3] + b[2] * b[3] - inter, diff = a[2] * a[3] - inter;
      const r = safe(() => [
        resultArea(l, l.intersection(R(...a), R(...b))),
        resultArea(l, l.union(R(...a), R(...b))),
        resultArea(l, l.difference(R(...a), R(...b))),
      ]);
      if (!r.ok) { fail++; continue; }
      worst = Math.max(worst, Math.abs(r.v[0] - inter), Math.abs(r.v[1] - uni), Math.abs(r.v[2] - diff));
    }
    return { worstErrorMm2: worst, exceptions: fail };
  });
}

// T2: a 6x6 grid of abutting rooms (shared walls) unioned into one floor.
T("T2 36 abutting rooms union: expect 1 polygon, 4 vertices", (l) => {
  let acc = l.union(R(0, 0, 3000, 3000), R(0, 0, 3000, 3000));
  const r = safe(() => {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) acc = l.union(l.flat ? toRegion(acc) : acc, R(i * 3000, j * 3000, 3000, 3000));
    return acc;
  });
  if (!r.ok) return { error: r.err };
  const open = (ring) => (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.length - 1 : ring.length);
  const verts = l.flat ? r.v.reduce((a, x) => a + open(x), 0) : r.v.reduce((a, p) => a + p.reduce((b, ring) => b + open(ring), 0), 0);
  return { polygons: polyCount(l, r.v), vertices: verts, area: resultArea(l, r.v), expectedArea: 18000 * 18000 };
});
function toRegion(rings) { return rings.map((r) => [r]); }

// T3: two rooms 0 mm apart (shared wall) versus 1 mm apart (a gap): the result must tell them apart.
T("T3 shared wall vs 1 mm gap: polygon counts after union", (l) => {
  const touch = safe(() => l.union(R(0, 0, 4000, 3000), R(4000, 0, 4000, 3000)));
  const gap = safe(() => l.union(R(0, 0, 4000, 3000), R(4001, 0, 4000, 3000)));
  return { touching: touch.ok ? polyCount(l, touch.v) : touch.err, oneMmGap: gap.ok ? polyCount(l, gap.v) : gap.err };
});

// T3b: two rooms whose shared wall differs by one nanometre of floating-point noise.
T("T3b shared wall with 1e-6 mm of float noise: polygons after union (want 1)", (l) => {
  const r = safe(() => l.union(R(0, 0, 4000, 3000), R(4000.000001, 0, 4000, 3000)));
  return r.ok ? { polygons: polyCount(l, r.v) } : { error: r.err };
});

// T4b: a room with a structural column (a hole).
T("T4b room minus a 1 m column: area and ring count (want 35e6, 2 rings)", (l) => {
  const r = safe(() => l.difference(R(0, 0, 6000, 6000), R(2500, 2500, 1000, 1000)));
  return r.ok ? { area: resultArea(l, r.v), rings: ringCount(l, r.v) } : { error: r.err };
});

// T4: degenerate input that real data contains.
T("T4 degenerate input", (l) => {
  const out = {};
  const dup = [[[[0, 0], [4000, 0], [4000, 0], [4000, 3000], [0, 3000], [0, 0]]]];
  const col = [[[[0, 0], [2000, 0], [4000, 0], [4000, 3000], [0, 3000]]]];
  const spike = [[[[0, 0], [4000, 0], [4000, 3000], [2000, 3000], [2000, 6000], [2000, 3000], [0, 3000]]]];
  const bow = [[[[0, 0], [4000, 3000], [4000, 0], [0, 3000]]]]; // self-crossing
  const touchv = [[[[0, 0], [4000, 0], [4000, 3000], [0, 3000]]], [[[4000, 1500], [7000, 500], [7000, 2500]]]]; // triangle touching at one point
  for (const [k, v, want] of [["duplicate vertex", dup, 12e6], ["collinear vertex", col, 12e6], ["zero-width spike", spike, 12e6], ["bow-tie (self-crossing)", bow, 6e6], ["two polygons touching at a point", touchv, 15e6]]) {
    const r = safe(() => l.union(v, R(10000, 10000, 1000, 1000)));
    out[k] = r.ok ? { area: resultArea(l, r.v) - 1e6, expected: want } : { error: r.err };
  }
  return out;
});

// T5: offsetting a room outline by a wall half-thickness, against hand-computed answers.
const Lout = 10200 * 4200 + 4200 * 4000 /* top bar + lower leg */ ; // outward 100: bar 10200x4200, leg x:-100..4100 y:4100..8100 -> 4200x4000
const Lin = 9800 * 3800 + 3800 * 4000; // inward 100: bar 9800x3800, leg x:100..3900 y:3900..7900
T("T5 offset an L-shaped room by 100 mm", (l) => {
  if (!l.offset) return { supported: false };
  const o = safe(() => resultArea(l, l.offset(L.map((r) => [r]), 100)));
  const i = safe(() => resultArea(l, l.offset(L.map((r) => [r]), -100)));
  const c = safe(() => l.offset(R(0, 0, 150, 3000), -100));
  return { outwardArea: o.ok ? o.v : o.err, expectedOutward: Lout, inwardArea: i.ok ? i.v : i.err, expectedInward: Lin, thinStripDeflateIsEmpty: c.ok ? (l.flat ? c.v.length === 0 : c.v.length === 0) : c.err };
});

// T6: speed.
const time = (fn, n) => { for (let i = 0; i < Math.min(50, n); i++) fn(i); const s = performance.now(); for (let i = 0; i < n; i++) fn(i); return performance.now() - s; };
{
  const rects = Array.from({ length: 2000 }, () => [ri(0, 15000), ri(0, 15000), ri(500, 8000), ri(500, 8000)]);
  const star = (n) => [Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2, r = i % 2 ? 6000 : 9000; return [Math.round(10000 + r * Math.cos(a)), Math.round(10000 + r * Math.sin(a))]; })];
  const star400 = [star(400)];
  T("T6 speed", (l) => {
    const inter = time((i) => l.intersection(R(...rects[i % 2000]), R(...rects[(i * 7 + 3) % 2000])), 20000);
    const lroom = time((i) => l.difference(L.map((r) => [r]), R(...rects[i % 2000])), 5000);
    const off = l.offset ? time(() => l.offset(star400, 50), 200) : null;
    return { rectIntersect20000Ms: Math.round(inter), lShapeMinusRoom5000Ms: Math.round(lroom), offsetStar400x200Ms: off === null ? "n/a" : Math.round(off) };
  });
}

// T7: fuzz on a coarse grid, where edges coincide constantly. Shapes are unions of three random
// rectangles; the identity area(A u B) = area(A) + area(B) - area(A n B) must hold exactly.
{
  const shape = (l) => { const g = () => R(ri(0, 10) * 1000, ri(0, 10) * 1000, ri(1, 6) * 1000, ri(1, 6) * 1000); let a = l.union(g(), g()); a = l.union(l.flat ? toRegion(a) : a, g()); return l.flat ? toRegion(a) : a; };
  T("T7 grid fuzz (1500 shape pairs): inclusion-exclusion violations / exceptions", (l) => {
    seed = 777; let bad = 0, fail = 0;
    for (let i = 0; i < 1500; i++) {
      const r = safe(() => {
        const A = shape(l), B = shape(l);
        const a = regionArea(A), b = regionArea(B);
        const u = resultArea(l, l.union(A, B)), n = resultArea(l, l.intersection(A, B)), d = resultArea(l, l.difference(A, B));
        return Math.abs(u - (a + b - n)) + Math.abs(d - (a - n));
      });
      if (!r.ok) fail++; else if (r.v > 0.5) bad++;
    }
    return { violations: bad, exceptions: fail };
  });
}

// T8: footprint.
const du = (p) => statSync(require.resolve(p)).size;
results.footprintBytes = {
  "clipper2-wasm (wasm + js loader)": du("clipper2-wasm/dist/umd/clipper2z.wasm") + du("clipper2-wasm/dist/umd/clipper2z.js"),
};

writeFileSync(new URL("../../results/kernel.json", import.meta.url), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
