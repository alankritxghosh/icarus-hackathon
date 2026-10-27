// A CAD drawing of the model as a DXF file (AutoCAD release 12 format, which every CAD program
// reads): one layer per kind of thing, millimetres, plan upright. Spaces and walls are closed
// polylines (curves keep their arcs as bulges), doors and windows are lines across the wall.

import { wallLength } from "./geometry";
import type { SpatialModel } from "./schema";

export interface DxfResult {
  dxf: string;
  /** What was left out, in words (for example openings on curved walls). */
  skipped: string[];
}

const layerName = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
const COLOURS: Record<string, number> = {
  WALLS: 7,
  DOORS: 3,
  WINDOWS: 5,
  COLUMNS: 1,
  LABELS: 8,
  SPACES: 8,
};

export function toDxf(model: SpatialModel): DxfResult {
  const skipped: string[] = [];
  const layers = new Set<string>(["WALLS", "DOORS", "WINDOWS", "COLUMNS", "LABELS"]);
  const body: string[] = [];
  const g = (code: number, value: string | number) => body.push(String(code), String(value));
  // The model has y running south; CAD has y running north. Mirroring flips curve direction too.
  const X = (v: number) => Math.round(v * 1000) / 1000;
  const Y = (v: number) => Math.round(-v * 1000) / 1000;

  const polyline = (
    layer: string,
    ring: { x: number; y: number; bulge?: number }[],
    closed: boolean,
  ) => {
    layers.add(layer);
    g(0, "POLYLINE");
    g(8, layer);
    g(66, 1);
    g(70, closed ? 1 : 0);
    for (const v of ring) {
      g(0, "VERTEX");
      g(8, layer);
      g(10, X(v.x));
      g(20, Y(v.y));
      if (v.bulge) g(42, -v.bulge);
    }
    g(0, "SEQEND");
    g(8, layer);
  };
  const line = (layer: string, a: [number, number], b: [number, number]) => {
    g(0, "LINE");
    g(8, layer);
    g(10, X(a[0]));
    g(20, Y(a[1]));
    g(11, X(b[0]));
    g(21, Y(b[1]));
  };
  const text = (layer: string, at: [number, number], height: number, value: string) => {
    g(0, "TEXT");
    g(8, layer);
    g(10, X(at[0]));
    g(20, Y(at[1]));
    g(40, height);
    g(1, value.replace(/[\r\n]+/g, " "));
  };

  for (const s of model.spaces) {
    const layer = `SPACE_${layerName(s.kind)}`;
    polyline(layer, s.boundary.outer, true);
    for (const h of s.boundary.holes) polyline(layer, h, true);
    const xs = s.boundary.outer.map((v) => v.x);
    const ys = s.boundary.outer.map((v) => v.y);
    text(
      "LABELS",
      [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2],
      250,
      s.name,
    );
  }
  for (const w of model.walls) {
    if (w.kind === "virtual") continue;
    if (w.bulge) {
      // A curved wall is drawn as its centreline arc; its thickness is not drawn.
      polyline(
        "WALLS",
        [
          { x: w.a.x, y: w.a.y, bulge: w.bulge },
          { x: w.b.x, y: w.b.y },
        ],
        false,
      );
      continue;
    }
    const len = wallLength(w.a, w.b);
    const nx = (-(w.b.y - w.a.y) / len) * (w.thicknessMm / 2);
    const ny = ((w.b.x - w.a.x) / len) * (w.thicknessMm / 2);
    polyline(
      "WALLS",
      [
        { x: w.a.x + nx, y: w.a.y + ny },
        { x: w.b.x + nx, y: w.b.y + ny },
        { x: w.b.x - nx, y: w.b.y - ny },
        { x: w.a.x - nx, y: w.a.y - ny },
      ],
      true,
    );
  }
  for (const o of model.openings) {
    const w = model.walls.find((x) => x.id === o.hostWallId);
    if (!w) continue;
    if (w.bulge) {
      skipped.push(`opening ${o.id} is on a curved wall`);
      continue;
    }
    const len = wallLength(w.a, w.b);
    const ux = (w.b.x - w.a.x) / len;
    const uy = (w.b.y - w.a.y) / len;
    line(
      o.kind === "window" ? "WINDOWS" : "DOORS",
      [w.a.x + ux * o.offsetMm, w.a.y + uy * o.offsetMm],
      [w.a.x + ux * (o.offsetMm + o.widthMm), w.a.y + uy * (o.offsetMm + o.widthMm)],
    );
  }
  for (const ob of model.obstacles) polyline("COLUMNS", ob.footprint.outer, true);

  const head: string[] = [];
  const h = (code: number, value: string | number) => head.push(String(code), String(value));
  h(0, "SECTION");
  h(2, "HEADER");
  h(9, "$ACADVER");
  h(1, "AC1009");
  h(9, "$INSUNITS");
  h(70, 4);
  h(0, "ENDSEC");
  h(0, "SECTION");
  h(2, "TABLES");
  h(0, "TABLE");
  h(2, "LAYER");
  h(70, layers.size);
  for (const name of [...layers].sort()) {
    h(0, "LAYER");
    h(2, name);
    h(70, 0);
    h(62, COLOURS[name] ?? COLOURS[name.split("_")[0] ?? ""] ?? 8);
    h(6, "CONTINUOUS");
  }
  h(0, "ENDTAB");
  h(0, "ENDSEC");
  h(0, "SECTION");
  h(2, "ENTITIES");
  const tail = ["0", "ENDSEC", "0", "EOF"];
  return { dxf: [...head, ...body, ...tail].join("\n") + "\n", skipped };
}
