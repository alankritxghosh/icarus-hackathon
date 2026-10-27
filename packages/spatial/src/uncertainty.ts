// What the model knows and what it is guessing, for the UI and for any exported claim.
import type { SpatialModel } from "./schema";

/** What the model knows and what it is guessing, for the UI and for any exported claim. */
export function uncertaintySummary(m: SpatialModel) {
  const all = [
    ...m.levels.map((x) => ({ id: x.id, kind: "level", p: x.provenance })),
    ...m.walls.map((x) => ({ id: x.id, kind: "wall", p: x.provenance })),
    ...m.openings.map((x) => ({ id: x.id, kind: "opening", p: x.provenance })),
    ...m.spaces.map((x) => ({ id: x.id, kind: "space", p: x.provenance })),
    ...m.obstacles.map((x) => ({ id: x.id, kind: "obstacle", p: x.provenance })),
  ];
  const bySource: Record<string, number> = {};
  for (const a of all) bySource[a.p.source] = (bySource[a.p.source] ?? 0) + 1;
  const guessed = all.filter((a) => a.p.source === "estimated" || a.p.source === "inferred");
  const unquantified = all.filter(
    (a) =>
      (a.p.source === "estimated" || a.p.source === "inferred" || a.p.source === "measured") &&
      a.p.toleranceMm === undefined,
  );
  const tolerances = all.map((a) => a.p.toleranceMm).filter((x): x is number => x !== undefined);
  const unknownStructural = m.walls.filter((w) => w.structural === "unknown").map((w) => w.id);
  const exact = guessed.length === 0 && unquantified.length === 0;
  return {
    bySource,
    guessedIds: guessed.map((a) => a.id),
    unquantifiedIds: unquantified.map((a) => a.id),
    worstToleranceMm: tolerances.length ? Math.max(...tolerances) : null,
    unknownStructuralWalls: unknownStructural.length,
    /** May a view present dimensions as exact? Only when nothing is guessed or unquantified. */
    mayShowAsExact: exact,
    /** May the product suggest removing or moving this wall? Never for structural or unknown. */
    wallMayBeMoved: (id: string) =>
      m.walls.find((w) => w.id === id)?.structural === "non_structural" &&
      m.walls.find((w) => w.id === id)?.provenance.source !== "inferred",
  };
}
