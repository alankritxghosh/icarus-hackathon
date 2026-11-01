// The Icarus spatial model (v2): the single source of truth for a building.
//
// Principles
//  - One source of truth for geometry. Rooms, walls, openings, obstacles, levels and items all live
//    here; plans, 3D, GLB, IFC and renders are projections of this model.
//  - Integer millimetres everywhere, so adjacency and equality are exact (no EPS comparisons).
//  - Curves are first-class through a DXF-style `bulge` on a boundary edge (tan(angle/4)), so a
//    circular room is two arcs, not a 64-gon, and DXF/IFC export has a direct mapping.
//  - Every geometric claim carries provenance (stated, measured, estimated, inferred, generated),
//    a tolerance and a confidence, so a reconstructed model can say what it knows.
//  - Names follow IFC (Space, Wall, Opening, Column) so export is a mapping, not a translation.
//  - Nothing here stores a solver's internal representation (no row orders, no canonical frames).
import { z } from "zod";

export const SCHEMA_VERSION = "icarus.spatial/0.1";

// Numeric conventions: x runs east and y runs south (as in plan coordinates elsewhere in Icarus).
// "Counter-clockwise" below means a positive shoelace sum in these numbers, and a wall's left side is
// the direction a->b rotated by +90 degrees in the same numbers.

const Mm = z.int();
export const Id = z.string().min(1).max(80);

/** A boundary vertex. `bulge` curves the edge from this vertex to the next: tan(included angle / 4). */
export const Vertex = z.object({ x: Mm, y: Mm, bulge: z.number().min(-20).max(20).optional() });
export type Vertex = z.infer<typeof Vertex>;

/** Counter-clockwise outer ring, optional clockwise holes (columns inside a space, courtyards). */
export const Polygon = z.object({
  outer: z.array(Vertex).min(3).max(2000),
  holes: z.array(z.array(Vertex).min(3).max(2000)).max(200).default([]),
});
export type Polygon = z.infer<typeof Polygon>;

export const Source = z.enum(["stated", "measured", "estimated", "inferred", "generated"]);
export type Source = z.infer<typeof Source>;

/**
 * Where a geometric fact came from and how far to trust it.
 *  stated:    the user said it ("the room is 8 m wide").
 *  measured:  taken from a scan or drawing, with a tolerance.
 *  estimated: derived from images with a model; the tolerance is the model's own error bound.
 *  inferred:  a guess to complete a model (the wall behind the camera).
 *  generated: produced by Icarus; exact by construction, but nobody has verified it on site.
 */
export const Provenance = z.object({
  source: Source,
  /** Positional uncertainty, millimetres. Missing means "not quantified", which is not "exact". */
  toleranceMm: Mm.min(0).optional(),
  confidence: z.number().min(0).max(1).optional(),
  evidence: z.array(Id).max(20).default([]),
});
export type Provenance = z.infer<typeof Provenance>;
export const GENERATED: Provenance = { source: "generated", evidence: [] };
const generated = GENERATED;

export const Level = z.object({
  id: Id,
  name: z.string().max(60),
  elevationMm: Mm,
  heightMm: Mm.min(2000).max(12000),
  /** The floor outline on this level. Spaces must lie inside it. */
  boundary: Polygon,
  provenance: Provenance.default(generated),
});

/**
 * `structural` is three-valued on purpose. A scan or a photograph cannot tell a load-bearing wall
 * from a partition, so "unknown" is a legal, visible value that blocks any wall-removal advice.
 */
/**
 * `virtual` is a boundary with no physical wall (IFC calls it a virtual element): a lobby opening
 * onto a corridor. It keeps adjacency explicit, so the circulation graph never has to guess.
 */
export const WallKind = z.enum(["exterior", "interior", "curtain", "party", "virtual"]);
export const Structural = z.enum(["structural", "non_structural", "unknown"]);

export const Wall = z.object({
  id: Id,
  levelId: Id,
  a: z.object({ x: Mm, y: Mm }),
  b: z.object({ x: Mm, y: Mm }),
  /** Curvature of the centreline from a to b (see Vertex.bulge). */
  bulge: z.number().min(-20).max(20).optional(),
  thicknessMm: Mm.min(20).max(2000),
  kind: WallKind,
  structural: Structural.default("unknown"),
  /**
   * An exterior wall the brief says is glazed. Windows are placed along it where the rooms behind it
   * want daylight; the flag itself survives even where no window fits.
   */
  glazed: z.boolean().default(false),
  /** Spaces on each side as seen walking from a to b; "exterior" for outside. */
  left: Id.optional(),
  right: Id.optional(),
  provenance: Provenance.default(generated),
});

export const OpeningKind = z.enum(["door", "window", "passage"]);
export const Opening = z.object({
  id: Id,
  hostWallId: Id,
  kind: OpeningKind,
  /** Distance along the wall from `a` to the opening's near edge. */
  offsetMm: Mm.min(0),
  widthMm: Mm.min(300),
  sillMm: Mm.min(0).default(0),
  headMm: Mm.min(300).default(2100),
  /** The front door of the building. */
  entrance: z.boolean().default(false),
  swing: z.object({ hinge: z.enum(["a", "b"]), toward: z.enum(["left", "right"]) }).optional(),
  provenance: Provenance.default(generated),
});

/** A room, circulation space or any other bounded volume of floor. */
export const Space = z.object({
  id: Id,
  levelId: Id,
  /** Key into a room-kind registry, for example "office.meeting_room" or "circulation.corridor". */
  kind: z.string().min(1).max(60),
  name: z.string().max(80),
  boundary: Polygon,
  programme: z
    .object({
      capacity: z.int().min(0).max(1000).optional(),
      targetAreaM2: z.number().min(0).max(100000).optional(),
    })
    .default({}),
  /**
   * What the floor is finished with. Inside a building it is always a hard or soft interior finish; turf
   * and gravel exist only so an outdoor space (kind "exterior.*") can say so, and the lessons reject them
   * anywhere else. Absent means the renderer chooses from the room kind.
   */
  floorFinish: z
    .enum(["tile", "wood", "carpet", "concrete", "stone", "terrazzo", "turf", "gravel"])
    .optional(),
  locked: z.boolean().default(false),
  /**
   * Where the room was when it was locked. A locked room may drift only a bounded distance from
   * here as its neighbours change, so the anchor must outlive each edit; without it every edit would
   * reset the starting point and the drift would be unbounded.
   */
  lockAt: z.object({ x: Mm, y: Mm }).optional(),
  provenance: Provenance.default(generated),
});

/** Things that occupy floor and constrain layout: columns, cores, shafts, existing walls to keep. */
export const Obstacle = z.object({
  id: Id,
  levelId: Id,
  kind: z.enum(["column", "core", "shaft", "retained_wall"]),
  footprint: Polygon,
  provenance: Provenance.default(generated),
});

/** Stairs and lifts: connect levels, each with a footprint on every level they serve. */
export const Connector = z.object({
  id: Id,
  kind: z.enum(["stair", "lift", "ramp"]),
  serves: z
    .array(z.object({ levelId: Id, footprint: Polygon }))
    .min(2)
    .max(40),
  clearWidthMm: Mm.min(300).optional(),
  /** Centreline of a walkable stair, in the building frame, from lower to upper landing. */
  path: z
    .array(
      z.object({ x: Mm, y: Mm, elevationMm: Mm, stepsToNext: z.int().min(1).max(100).optional() }),
    )
    .min(2)
    .max(100)
    .optional(),
  provenance: Provenance.default(generated),
});

/**
 * Furniture and fixtures. The footprint is `sizeMm` centred on `at`, turned by `rotationDeg`. With no turn the front
 * of the item faces +y (south on the plan); a positive turn swings the front clockwise on the plan, so 90 faces west.
 */
export const Item = z.object({
  id: Id,
  spaceId: Id,
  kind: z.string().min(1).max(60),
  at: z.object({ x: Mm, y: Mm }),
  sizeMm: z.object({ w: Mm.min(1), d: Mm.min(1), h: Mm.min(1) }),
  rotationDeg: z.number().min(-360).max(360).default(0),
  /** Free space this item needs in front of it, in millimetres. */
  clearFrontMm: Mm.min(0).default(0),
  anchoredToWallId: Id.optional(),
  provenance: Provenance.default(generated),
});

export const SpatialModel = z.object({
  schema: z.literal(SCHEMA_VERSION),
  units: z.literal("mm"),
  name: z.string().max(120),
  /** Degrees clockwise from the +y axis to north; the model itself is in its own frame. */
  northDeg: z.number().min(-360).max(360).default(0),
  levels: z.array(Level).min(1).max(200),
  spaces: z.array(Space).max(5000),
  walls: z.array(Wall).max(20000),
  openings: z.array(Opening).max(20000),
  obstacles: z.array(Obstacle).max(5000).default([]),
  connectors: z.array(Connector).max(500).default([]),
  items: z.array(Item).max(50000).default([]),
});
export type SpatialModel = z.infer<typeof SpatialModel>;
export type Space = z.infer<typeof Space>;
export type Wall = z.infer<typeof Wall>;
export type Opening = z.infer<typeof Opening>;
export type Level = z.infer<typeof Level>;
