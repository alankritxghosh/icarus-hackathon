// The geometry kernel: boolean operations and offsetting on integer-millimetre regions, on
// Clipper2 compiled to WebAssembly. Integer coordinates are the point: two walls that agree to the
// millimetre are the same wall, with no tolerance to tune (a measured difference between this and
// float libraries is in docs/RESEARCH_ROUND_2.md).
//
// The wasm binary is passed in by the caller because the package assumes a browser and fetches the
// file by URL. In Node read it from `clipper2-wasm/dist/umd/clipper2z.wasm`; in a browser fetch it.
import type { MainModule, Path64, Paths64, PolyPath64 } from "clipper2-wasm/dist/clipper2z";
import factory from "clipper2-wasm/dist/umd/clipper2z.js";
import { cleanRing, type Poly, type Pt, type Region, regionArea, signedArea } from "./geometry";

export interface Kernel {
  union(a: Region, b: Region): Region;
  unionAll(regions: Region[]): Region;
  intersection(a: Region, b: Region): Region;
  difference(a: Region, b: Region): Region;
  /** Grow (positive) or shrink (negative) by `deltaMm`, mitred corners. An emptied region is []. */
  offset(region: Region, deltaMm: number, miterLimit?: number): Region;
  /** Square millimetres shared by two regions. */
  overlapArea(a: Region, b: Region): number;
}

export async function createKernel(options: {
  wasmBinary: ArrayBuffer | Uint8Array;
}): Promise<Kernel> {
  const C: MainModule = await factory({ wasmBinary: options.wasmBinary });

  // Outers positive and holes negative, so the NonZero rule treats nesting correctly.
  const toPaths = (region: Region): Paths64 => {
    const paths = new C.Paths64();
    for (const poly of region)
      poly.forEach((ring, i) => {
        if (ring.length < 3) return;
        const want = i === 0 ? 1 : -1;
        const oriented = Math.sign(signedArea(ring)) === want ? ring : [...ring].reverse();
        const path = C.MakePath64(oriented.flat().map((v) => BigInt(v)));
        paths.push_back(path);
        path.delete();
      });
    return paths;
  };

  const readRing = (p: Path64): Pt[] => {
    const out: Pt[] = [];
    for (let i = 0; i < p.size(); i++) {
      const pt = p.get(i);
      out.push([Number(pt.x), Number(pt.y)]);
    }
    return out;
  };

  // The polytree alternates outer, hole, outer, hole by depth.
  const collect = (node: PolyPath64, depth: number, out: Region) => {
    for (let i = 0; i < node.count(); i++) {
      const child = node.child(i);
      const poly = child.polygon();
      const ring = cleanRing(readRing(poly));
      poly.delete();
      if (depth % 2 === 0) {
        if (ring.length >= 3 && Math.abs(signedArea(ring)) > 0) {
          const outer = signedArea(ring) > 0 ? ring : [...ring].reverse();
          const holes: Poly = [outer];
          for (let h = 0; h < child.count(); h++) {
            const hole = child.child(h);
            const hp = hole.polygon();
            const hr = cleanRing(readRing(hp));
            hp.delete();
            if (hr.length >= 3) holes.push(signedArea(hr) < 0 ? hr : [...hr].reverse());
            collect(hole, depth + 2, out);
          }
          out.push(holes);
        }
      }
    }
  };

  const fromTree = (tree: PolyPath64): Region => {
    const out: Region = [];
    collect(tree, 0, out);
    return out;
  };

  const run = (op: "Intersection" | "Union" | "Difference", a: Region, b: Region): Region => {
    const A = toPaths(a);
    const B = toPaths(b);
    const tree = new C.PolyPath64();
    C.BooleanOpOut64(C.ClipType[op], C.FillRule.NonZero, A, B, tree);
    const out = fromTree(tree);
    tree.delete();
    A.delete();
    B.delete();
    return out;
  };

  const kernel: Kernel = {
    union: (a, b) => run("Union", a, b),
    intersection: (a, b) => run("Intersection", a, b),
    difference: (a, b) => run("Difference", a, b),
    unionAll: (regions) => regions.reduce<Region>((acc, r) => run("Union", acc, r), []),
    offset(region, deltaMm, miterLimit = 5) {
      if (!region.length) return [];
      const A = toPaths(region);
      const inflated = C.InflatePaths64(
        A,
        deltaMm,
        C.JoinType.Miter,
        C.EndType.Polygon,
        miterLimit,
        0,
      );
      const none = new C.Paths64();
      const tree = new C.PolyPath64();
      C.BooleanOpOut64(C.ClipType.Union, C.FillRule.NonZero, inflated, none, tree);
      const out = fromTree(tree);
      tree.delete();
      none.delete();
      inflated.delete();
      A.delete();
      return out;
    },
    overlapArea: (a, b) => regionArea(run("Intersection", a, b)),
  };
  return kernel;
}
