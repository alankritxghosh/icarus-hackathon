import { SCHEMA_VERSION, type Space, SpatialModel } from "./schema";

/** A room rectangle reviewed against the visible PDF sheet, in the building's millimetre frame. */
export interface RoomTrace {
  id: string;
  levelId: string;
  name: string;
  rect: [number, number, number, number];
}

function roomKind(name: string): string {
  const n = name.toLowerCase();
  if (/landscape|garden/.test(n)) return "exterior.landscape";
  if (/balcony|deck/.test(n)) return "exterior.balcony";
  if (/lift/.test(n)) return "circulation.lift";
  if (/stair/.test(n)) return "circulation.stair";
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
  if (/transition|lobby/.test(n)) return "circulation.hall";
  return "drawing.room";
}

/** Rebuilds reviewed rooms from the original import. The PDF's large guessed perimeter is not carried into a trace. */
export function modelWithRoomTraces(base: SpatialModel, traces: RoomTrace[]): SpatialModel {
  if (base.schema !== SCHEMA_VERSION) throw new Error("unsupported model");
  const levelIds = new Set(base.levels.map((level) => level.id));
  const valid = traces.map((trace) => {
    const [x0, y0, x1, y1] = trace.rect.map(Math.round) as RoomTrace["rect"];
    if (!levelIds.has(trace.levelId) || !trace.name.trim() || x1 - x0 < 500 || y1 - y0 < 500)
      throw new Error("room trace needs a level, name and at least 0.5 m in both directions");
    return { ...trace, rect: [x0, y0, x1, y1] as RoomTrace["rect"] };
  });
  // Once a person traces a plan, its reviewed rooms replace the partial automatic geometry.
  const spaces: SpatialModel["spaces"] = valid.length ? [] : [...base.spaces];
  const walls: SpatialModel["walls"] = valid.length ? [] : [...base.walls];
  const openings: SpatialModel["openings"] = valid.length ? [] : [...base.openings];
  for (const trace of valid) {
    const [x0, y0, x1, y1] = trace.rect;
    const kind = roomKind(trace.name);
    const outdoor = kind.startsWith("exterior.");
    const provenance = {
      source: "estimated" as const,
      toleranceMm: 150,
      confidence: 0.7,
      evidence: [],
    };
    const finish: Space["floorFinish"] = /landscape/.test(kind)
      ? "turf"
      : outdoor
        ? "stone"
        : /toilet|shower|kitchen|utility/.test(kind)
          ? "tile"
          : "wood";
    spaces.push({
      id: `trace.${trace.levelId}.${trace.id}`,
      levelId: trace.levelId,
      kind,
      name: trace.name,
      boundary: {
        outer: [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ],
        holes: [],
      },
      programme: {},
      floorFinish: finish,
      locked: false,
      provenance,
    });
    if (outdoor || kind.startsWith("circulation.")) continue;
    const edges = [
      [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
      ],
      [
        { x: x1, y: y0 },
        { x: x1, y: y1 },
      ],
      [
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ],
      [
        { x: x0, y: y1 },
        { x: x0, y: y0 },
      ],
    ] as const;
    edges.forEach(([a, b], i) => {
      walls.push({
        id: `trace.${trace.levelId}.${trace.id}.w${i}`,
        levelId: trace.levelId,
        a,
        b,
        thicknessMm: 120,
        kind: "interior",
        structural: "unknown",
        glazed: false,
        provenance,
      });
    });
  }
  // Rectangles are a reviewed approximation. Give adjacent rooms a visible, traversable doorway
  // at their shared edge, including the lobby-to-foyer entrance on the lower supplied floor.
  for (let a = 0; a < valid.length; a++) {
    const first = valid[a];
    if (!first) continue;
    for (let b = a + 1; b < valid.length; b++) {
      const second = valid[b];
      if (!second || first.levelId !== second.levelId) continue;
      const [ax0, ay0, ax1, ay1] = first.rect;
      const [bx0, by0, bx1, by1] = second.rect;
      const horizontal = Math.min(ax1, bx1) - Math.max(ax0, bx0);
      const vertical = Math.min(ay1, by1) - Math.max(ay0, by0);
      const meetsBelow = Math.abs(ay1 - by0) <= 250;
      const meetsAbove = Math.abs(by1 - ay0) <= 250;
      const meetsRight = Math.abs(ax1 - bx0) <= 250;
      const meetsLeft = Math.abs(bx1 - ax0) <= 250;
      const overlap =
        horizontal >= 1000 && (meetsBelow || meetsAbove)
          ? {
              axis: "x" as const,
              start: Math.max(ax0, bx0),
              end: Math.min(ax1, bx1),
              edgeA: meetsBelow ? ay1 : ay0,
              edgeB: meetsBelow ? by0 : by1,
            }
          : vertical >= 1000 && (meetsRight || meetsLeft)
            ? {
                axis: "y" as const,
                start: Math.max(ay0, by0),
                end: Math.min(ay1, by1),
                edgeA: meetsRight ? ax1 : ax0,
                edgeB: meetsRight ? bx0 : bx1,
              }
            : undefined;
      if (!overlap) continue;
      const centre = (overlap.start + overlap.end) / 2;
      const width = Math.min(900, overlap.end - overlap.start - 100);
      if (width < 700) continue;
      const both = [first, second];
      for (const trace of both) {
        const edge = trace === first ? overlap.edgeA : overlap.edgeB;
        const host = walls.find(
          (wall) =>
            wall.levelId === trace.levelId &&
            wall.id.startsWith(`trace.${trace.levelId}.${trace.id}.w`) &&
            (overlap.axis === "x"
              ? wall.a.y === edge && wall.b.y === edge
              : wall.a.x === edge && wall.b.x === edge),
        );
        if (!host) continue;
        const coordinate = overlap.axis === "x" ? host.a.x : host.a.y;
        const along = Math.abs(centre - coordinate);
        const offsetMm = Math.round(along - width / 2);
        if (offsetMm < 0) continue;
        openings.push({
          id: `review-door.${first.id}.${second.id}.${trace.id}`,
          hostWallId: host.id,
          kind: "passage",
          offsetMm,
          widthMm: width,
          sillMm: 0,
          headMm: 2100,
          entrance:
            /\bfoyer\b/i.test(`${first.name} ${second.name}`) &&
            /\blobby\b/i.test(`${first.name} ${second.name}`),
          provenance: { source: "estimated", toleranceMm: 250, confidence: 0.5, evidence: [] },
        });
      }
    }
  }
  const levels = base.levels.map((level) => {
    const own = valid.filter((trace) => trace.levelId === level.id);
    if (!own.length) return level;
    const xs = [
      ...level.boundary.outer.map((point) => point.x),
      ...own.flatMap((trace) => [trace.rect[0], trace.rect[2]]),
    ];
    const ys = [
      ...level.boundary.outer.map((point) => point.y),
      ...own.flatMap((trace) => [trace.rect[1], trace.rect[3]]),
    ];
    const x0 = Math.min(...xs),
      x1 = Math.max(...xs),
      y0 = Math.min(...ys),
      y1 = Math.max(...ys);
    return {
      ...level,
      boundary: {
        outer: [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ],
        holes: [],
      },
    };
  });
  return SpatialModel.parse({
    ...base,
    levels,
    spaces,
    walls,
    openings,
  });
}
