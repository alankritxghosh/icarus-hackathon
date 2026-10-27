// Three polygon libraries behind one tiny interface so the same tests run on each.
// A polygon is an array of rings of [x, y] in integer millimetres: ring 0 is the outer boundary,
// later rings are holes. A region is an array of polygons.
import { createRequire } from "node:module";
import polygonClipping from "polygon-clipping";
import "jsts/org/locationtech/jts/monkey.js";
import Coordinate from "jsts/org/locationtech/jts/geom/Coordinate.js";
import GeometryFactory from "jsts/org/locationtech/jts/geom/GeometryFactory.js";
import BufferOp from "jsts/org/locationtech/jts/operation/buffer/BufferOp.js";
import BufferParameters from "jsts/org/locationtech/jts/operation/buffer/BufferParameters.js";

const jsts = {
  geom: { GeometryFactory, Coordinate },
  operation: { buffer: { BufferOp, BufferParameters } },
};

const require = createRequire(import.meta.url);

export const ringArea = (ring) => {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
};
export const polyArea = (p) => Math.abs(ringArea(p[0])) - p.slice(1).reduce((a, r) => a + Math.abs(ringArea(r)), 0);
export const regionArea = (r) => r.reduce((a, p) => a + polyArea(p), 0);

export async function loadAll() {
  // --- polygon-clipping (MIT, pure JS, robust predicates, float coordinates) ---
  const pc = {
    name: "polygon-clipping",
    version: require("polygon-clipping/package.json").version,
    license: "MIT",
    union: (a, b) => polygonClipping.union(a, b),
    intersection: (a, b) => polygonClipping.intersection(a, b),
    difference: (a, b) => polygonClipping.difference(a, b),
    offset: null,
  };

  // --- JSTS (EDL-1.0 or EPL-1.0, JTS port, float coordinates) ---
  const f = new jsts.geom.GeometryFactory();
  const toG = (region) =>
    f.createMultiPolygon(
      region.map((p) =>
        f.createPolygon(
          f.createLinearRing(closed(p[0]).map(([x, y]) => new jsts.geom.Coordinate(x, y))),
          p.slice(1).map((r) => f.createLinearRing(closed(r).map(([x, y]) => new jsts.geom.Coordinate(x, y)))),
        ),
      ),
    );
  const fromG = (g) => {
    const out = [];
    const polys = g.getGeometryType() === "Polygon" ? [g] : g.getGeometryType() === "MultiPolygon" || g.getGeometryType() === "GeometryCollection"
      ? Array.from({ length: g.getNumGeometries() }, (_, i) => g.getGeometryN(i)).filter((x) => x.getGeometryType() === "Polygon") : [];
    for (const p of polys) {
      if (p.isEmpty()) continue;
      const rings = [p.getExteriorRing(), ...Array.from({ length: p.getNumInteriorRing() }, (_, i) => p.getInteriorRingN(i))];
      out.push(rings.map((r) => r.getCoordinates().slice(0, -1).map((c) => [c.x, c.y])));
    }
    return out;
  };
  const closed = (r) => [...r, r[0]];
  const bufOp = jsts.operation.buffer.BufferOp;
  const BP = jsts.operation.buffer.BufferParameters;
  const js = {
    name: "jsts",
    version: require("jsts/package.json").version,
    license: "EDL-1.0 OR EPL-1.0",
    union: (a, b) => fromG(toG(a).union(toG(b))),
    intersection: (a, b) => fromG(toG(a).intersection(toG(b))),
    difference: (a, b) => fromG(toG(a).difference(toG(b))),
    offset: (region, d) => {
      const params = new BP(8, BP.CAP_FLAT, BP.JOIN_MITRE, 5);
      return fromG(bufOp.bufferOp(toG(region), d, params));
    },
  };

  // --- Clipper2 WASM (BSL-1.0, integer coordinates, C++ compiled to WebAssembly) ---
  const factory = require("clipper2-wasm/dist/umd/clipper2z.js");
  // The package assumes a browser and fetches the .wasm by URL; in Node the binary must be handed in.
  const { readFileSync } = await import("node:fs");
  const wasmBinary = readFileSync(require.resolve("clipper2-wasm/dist/umd/clipper2z.wasm"));
  const C = await factory({ wasmBinary });
  const toPaths = (region) => {
    const ps = new C.Paths64();
    for (const poly of region) for (const ring of poly) ps.push_back(C.MakePath64(ring.flat().map((v) => BigInt(Math.round(v)))));
    return ps;
  };
  // Clipper2 returns flat paths; with the EvenOdd rule outer rings and holes alternate by nesting,
  // so area is the signed sum of all rings (outers positive, holes negative) rather than a tree.
  const readPaths = (ps) => {
    const rings = [];
    for (let i = 0; i < ps.size(); i++) {
      const p = ps.get(i);
      const ring = [];
      for (let j = 0; j < p.size(); j++) ring.push([Number(p.get(j).x), Number(p.get(j).y)]);
      rings.push(ring);
    }
    return rings;
  };
  const op = (name) => (a, b) => {
    const A = toPaths(a), B = toPaths(b);
    const r = C[name](A, B, C.FillRule.NonZero);
    const rings = readPaths(r);
    A.delete(); B.delete(); r.delete();
    return rings;
  };
  const cl = {
    name: "clipper2-wasm",
    version: require("clipper2-wasm/package.json").version,
    license: "BSL-1.0",
    flat: true,
    union: op("Union64"),
    intersection: op("Intersect64"),
    difference: op("Difference64"),
    offset: (region, d) => {
      const A = toPaths(region);
      const r = C.InflatePaths64(A, d, C.JoinType.Miter, C.EndType.Polygon, 5, 0);
      const rings = readPaths(r);
      A.delete(); r.delete();
      return rings;
    },
  };
  return [pc, js, cl];
}

// Area of a library result: Clipper returns flat rings with a sign for hole vs outer (positive
// orientation = outer under NonZero in its output), the others return polygons with holes.
export const resultArea = (lib, res) =>
  lib.flat ? res.reduce((a, r) => a + ringArea(r), 0) * 1 : regionArea(res);
export const ringCount = (lib, res) => (lib.flat ? res.length : res.reduce((a, p) => a + p.length, 0));
export const polyCount = (lib, res) => (lib.flat ? res.filter((r) => ringArea(r) > 0).length : res.length);
