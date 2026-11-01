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
    openings: valid.length ? [] : base.openings,
  });
}
