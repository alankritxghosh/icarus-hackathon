// Example buildings in the draft v2 model: converted from real v1 plans and solver output, plus
// hand-authored cases that v1 cannot express (curves, columns, two levels, reconstructed geometry).
import { readFileSync } from "node:fs";
import { buildModel, type RectSpace } from "./adapter.ts";
import { GENERATED, type SpatialModel, type Vertex } from "./spatial.ts";

const results = new URL("../../results/", import.meta.url);
const mm = (m: number) => Math.round(m * 1000);

/** A real v1 plan (the row-layout baseline for an evaluation brief) as a v2 model. */
export function fromV1(briefName: string): { model: SpatialModel; gapAreaM2: number } {
  const data = JSON.parse(readFileSync(new URL("problems.json", results), "utf8"));
  const p = data.problems.find((x: { name: string }) => x.name === briefName);
  const W = mm(p.shell.widthM), D = mm(p.shell.depthM);
  const spaces: RectSpace[] = [
    ...p.baseline.plan.rooms.map((r: any) => {
      const t = p.rooms.find((x: any) => x.id === r.id);
      return { id: r.id, kind: `office.${r.kind}`, name: t.name, x0: mm(r.rect.x), y0: mm(r.rect.y), x1: mm(r.rect.x + r.rect.w), y1: mm(r.rect.y + r.rect.h), capacity: t.capacity ?? undefined, targetAreaM2: t.targetAreaM2 };
    }),
    ...p.baseline.plan.circulation.map((c: any) => ({ id: c.id, kind: `circulation.${c.kind}`, name: c.id, x0: mm(c.rect.x), y0: mm(c.rect.y), x1: mm(c.rect.x + c.rect.w), y1: mm(c.rect.y + c.rect.h) })),
  ];
  const doors = p.baseline.plan.rooms.map((r: any) => ({ space: r.id, x: mm(r.door.x), y: mm(r.door.y), widthMm: mm(r.door.widthM) }));
  const e = p.baseline.plan.entrance;
  const model = buildModel({
    name: `${briefName} (from v1 plan)`,
    boundary: [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: D }, { x: 0, y: D }],
    spaces, doors, entrance: { x: mm(e.x), y: mm(e.y), widthMm: mm(e.widthM) },
  });
  const covered = spaces.reduce((a, s) => a + (s.x1 - s.x0) * (s.y1 - s.y0), 0);
  return { model, gapAreaM2: (W * D - covered) / 1e6 };
}

/** The CP-SAT result for an L-shaped floor, with two round columns. v1 cannot represent this. */
export function lShapedWithColumns(): SpatialModel {
  const d = JSON.parse(readFileSync(new URL("cpsat_demo.json", results), "utf8"))[0].L;
  const W = mm(d.geo.W), D = mm(d.geo.D);
  const [nx, , , ny] = d.geo.notch.map((c: number) => c * 100); // decimetres to mm
  const spaces: RectSpace[] = d.rooms.map((r: any) => ({ id: r.id, kind: `office.${r.kind}`, name: r.id, x0: mm(r.rect.x), y0: mm(r.rect.y), x1: mm(r.rect.x + r.rect.w), y1: mm(r.rect.y + r.rect.h) }));
  const yc = ny + Math.round((D - ny) / 2);
  spaces.push({ id: "lobby", kind: "circulation.lobby", name: "Lobby", x0: 0, y0: 0, x1: 2000, y1: D });
  spaces.push({ id: "spine", kind: "circulation.corridor", name: "Corridor", x0: 2000, y0: yc - 800, x1: W, y1: yc + 800 });
  const model = buildModel({
    name: "L-shaped office (CP-SAT) with columns",
    boundary: [{ x: 0, y: 0 }, { x: nx, y: 0 }, { x: nx, y: ny }, { x: W, y: ny }, { x: W, y: D }, { x: 0, y: D }],
    spaces, entrance: { x: 0, y: Math.round(D / 2), widthMm: 1800 },
  });
  const column = (cx: number, cy: number, r = 250): Vertex[] => [
    { x: cx + r, y: cy, bulge: Math.tan(Math.PI / 8) }, { x: cx, y: cy + r, bulge: Math.tan(Math.PI / 8) },
    { x: cx - r, y: cy, bulge: Math.tan(Math.PI / 8) }, { x: cx, y: cy - r, bulge: Math.tan(Math.PI / 8) },
  ];
  model.obstacles = [
    { id: "col.1", levelId: "L0", kind: "column", footprint: { outer: column(7000, 4000), holes: [] }, provenance: GENERATED },
    { id: "col.2", levelId: "L0", kind: "column", footprint: { outer: column(12000, 4000), holes: [] }, provenance: GENERATED },
  ];
  return model;
}

/** A rectangular floor with a circular conference room: curved walls via bulge, a curved hole. */
export function circularConferenceRoom(): SpatialModel {
  const cx = 10000, cy = 6000, r = 3500, b = Math.tan(Math.PI / 8);
  const ccw = (): Vertex[] => [{ x: cx + r, y: cy, bulge: b }, { x: cx, y: cy + r, bulge: b }, { x: cx - r, y: cy, bulge: b }, { x: cx, y: cy - r, bulge: b }];
  const cw = (): Vertex[] => [{ x: cx + r, y: cy, bulge: -b }, { x: cx, y: cy - r, bulge: -b }, { x: cx - r, y: cy, bulge: -b }, { x: cx, y: cy + r, bulge: -b }];
  const outer: Vertex[] = [{ x: 0, y: 0 }, { x: 20000, y: 0 }, { x: 20000, y: 12000 }, { x: 0, y: 12000 }];
  const wallArc = (id: string, a: [number, number], c: [number, number], bulge: number) => ({
    id, levelId: "L0", a: { x: a[0], y: a[1] }, b: { x: c[0], y: c[1] }, bulge, thicknessMm: 150, kind: "interior" as const,
    structural: "non_structural" as const, left: "conf", right: "floor", provenance: GENERATED,
  });
  return {
    schema: "icarus.spatial/0.1", units: "mm", name: "Floor with a circular conference room", northDeg: 0,
    levels: [{ id: "L0", name: "Level 0", elevationMm: 0, heightMm: 3000, boundary: { outer, holes: [] }, provenance: GENERATED }],
    spaces: [
      { id: "conf", levelId: "L0", kind: "office.meeting_room", name: "Round conference room", boundary: { outer: ccw(), holes: [] }, programme: { capacity: 14 }, locked: false, provenance: GENERATED },
      { id: "floor", levelId: "L0", kind: "office.open_workspace", name: "Open workspace", boundary: { outer, holes: [cw()] }, programme: {}, locked: false, provenance: GENERATED },
    ],
    walls: [
      wallArc("wall.arc.1", [cx + r, cy], [cx - r, cy], 1), // the lower half; bulge 1 is a semicircle
      wallArc("wall.arc.2", [cx - r, cy], [cx + r, cy], 1), // the upper half
    ],
    openings: [{ id: "door.1", hostWallId: "wall.arc.1", kind: "door", offsetMm: 2000, widthMm: 1000, sillMm: 0, headMm: 2100, entrance: true, provenance: GENERATED }],
    obstacles: [], connectors: [], items: [],
  };
}

/** Two levels joined by a stair; each level has a lobby and one room. */
export function twoLevelBuilding(): SpatialModel {
  const one = (levelId: string, elev: number, lobbyId: string, roomId: string) => {
    const m = buildModel({
      name: levelId, levelId,
      boundary: [{ x: 0, y: 0 }, { x: 12000, y: 0 }, { x: 12000, y: 8000 }, { x: 0, y: 8000 }],
      spaces: [
        { id: lobbyId, kind: "circulation.lobby", name: "Lobby", x0: 0, y0: 0, x1: 4000, y1: 8000 },
        { id: roomId, kind: "office.open_workspace", name: "Workspace", x0: 4000, y0: 0, x1: 12000, y1: 8000 },
      ],
      entrance: { x: 0, y: 4000, widthMm: 1800 },
    });
    m.levels[0]!.elevationMm = elev;
    return m;
  };
  const a = one("L0", 0, "lobby0", "work0");
  const b = one("L1", 3200, "lobby1", "work1");
  // only the ground level has a front door
  b.openings = b.openings.filter((o) => !o.entrance).map((o) => ({ ...o, id: `${o.id}.L1` }));
  const rename = <T extends { id: string }>(xs: T[], suffix: string) => xs.map((x) => ({ ...x, id: `${x.id}${suffix}` }));
  const walls1 = b.walls.map((w) => ({ ...w, id: `${w.id}.L1` }));
  b.openings = b.openings.map((o) => ({ ...o, hostWallId: `${o.hostWallId.replace(".L1", "")}.L1` }));
  const stair = (l: string) => ({ levelId: l, footprint: { outer: [{ x: 500, y: 500 }, { x: 2500, y: 500 }, { x: 2500, y: 3500 }, { x: 500, y: 3500 }], holes: [] } });
  return {
    ...a, name: "Two-level building",
    levels: [...a.levels, ...b.levels],
    spaces: [...a.spaces, ...b.spaces],
    walls: [...a.walls, ...walls1],
    openings: [...a.openings, ...rename(b.openings, "")],
    connectors: [{ id: "stair.1", kind: "stair", serves: [stair("L0"), stair("L1")], clearWidthMm: 1100, provenance: GENERATED }],
  };
}

/** A room "reconstructed" from photographs: some walls measured, some estimated, one guessed. */
export function reconstructedRoom(): SpatialModel {
  const prov = (source: "measured" | "estimated" | "inferred", toleranceMm?: number, confidence?: number) => ({ source, toleranceMm, confidence, evidence: ["photo.1"] });
  const outer: Vertex[] = [{ x: 0, y: 0 }, { x: 8200, y: 0 }, { x: 8200, y: 5400 }, { x: 0, y: 5400 }];
  const wall = (id: string, a: [number, number], b: [number, number], p: ReturnType<typeof prov>, structural: "structural" | "non_structural" | "unknown", left: string, right: string) => ({
    id, levelId: "L0", a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] }, thicknessMm: 200, kind: "exterior" as const, structural, left, right, provenance: p,
  });
  return {
    schema: "icarus.spatial/0.1", units: "mm", name: "Room reconstructed from two photos", northDeg: 0,
    levels: [{ id: "L0", name: "Level 0", elevationMm: 0, heightMm: 2900, boundary: { outer, holes: [] }, provenance: prov("estimated", 400, 0.6) }],
    spaces: [{ id: "room", levelId: "L0", kind: "office.open_workspace", name: "Room", boundary: { outer, holes: [] }, programme: {}, locked: false, provenance: prov("estimated", 300, 0.6) }],
    walls: [
      wall("w.north", [0, 0], [8200, 0], prov("measured", 30, 0.95), "structural", "room", "exterior"),
      wall("w.east", [8200, 0], [8200, 5400], prov("estimated", 250, 0.7), "unknown", "room", "exterior"),
      wall("w.south", [0, 5400], [8200, 5400], prov("estimated", 300, 0.6), "unknown", "exterior", "room"),
      wall("w.west", [0, 0], [0, 5400], prov("inferred", undefined, 0.3), "unknown", "exterior", "room"),
    ],
    openings: [], obstacles: [], connectors: [], items: [],
  };
}
