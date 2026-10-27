# Spatial model (M0) and geometry kernel (M1)

`packages/spatial` holds the v2 model of a building and the geometry kernel under it. The layout engine in `packages/core` is untouched: a `FloorPlan` is converted to and from the model by an adapter, so the two run side by side while the engine is migrated. Background and measurements: [ARCHITECTURE_ASSESSMENT.md](ARCHITECTURE_ASSESSMENT.md) and [RESEARCH_ROUND_2.md](RESEARCH_ROUND_2.md).

## What is in the package

| File | Purpose |
|---|---|
| `schema.ts` | The model: levels, spaces, walls, openings, obstacles, connectors, items. Integer millimetres. Curves by `bulge`. Provenance on every geometric fact. Glazed sides. |
| `geometry.ts` | Arc flattening onto the grid, signed area, simple-ring test, exact collinear clean-up, point in region. |
| `kernel.ts` | Boolean operations and offsetting on Clipper2 WebAssembly. Regions are polygons with holes in integer millimetres. The caller passes the wasm binary. |
| `predicates.ts` | Polygon versions of the rectangle questions core asks (shared wall, overlap, containment). |
| `validate.ts` | Ids, winding, simple rings, spaces inside the level, no overlaps, wall sides true, openings on their wall, door width warning. |
| `circulation.ts` | Which spaces the front door reaches by doors, wall-less boundaries and stairs. |
| `uncertainty.ts` | What may be shown as exact, and which walls may be suggested for moving. |
| `adapter.ts` | `fromFloorPlan`, `toFloorPlan`, `snapPlanToMm`. Reports what a plan cannot hold. |
| `migrate.ts` | `upgradeSaved`: adds the model to a saved office; idempotent. |

## The gate

The migration is gated on two things, run by `test/eval/gate.eval.test.ts` (set `SPATIAL_GATE_OUT=file.json`; skipped otherwise because it takes about two minutes). The recorded result is `docs/reference/spatial-gate/gate-run1.json`.

1. **Unchanged.** `core` has 172 tests and all pass, unmodified. The design set (12 briefs, variants A and B) reproduces the recorded scores to 1e-9. The edit set (158 requests) reproduces the recorded tally and per-kind counts exactly: 86 applied, 36 unchanged, 36 refused, 0 new failures.
2. **Through the model.** Every plan those sets produce (24 design plans, 86 edited plans) is converted, validated, walked, converted back and measured again. Results: 0 validation errors, every room reachable, 0 differences when a plan already on the grid goes round, and identical measured issues (cost drift 0).

### One finding from the gate

The layout engine works in floating point, and its furnishing code decides whether a seat fits with a tolerance of one micrometre. Snapping a plan to the millimetre grid, with no model involved, changed what the engine measured in **1 of 110 plans**: a workspace 5.57314 m deep became 5.573 m and lost a seat (8 to 7), which added a `seats_short` failure. The adapter is not at fault: the same plan, once snapped, goes through the model exactly. It means the grid is now the truth, and the engine should snap its output at the source (or use a one-millimetre tolerance) when it moves onto the model. I did not change `core` to do that, because the gate requires it unchanged. The gate bounds this effect at 2% of plans so a regression cannot hide in it; today it is 0.9%.

## What changed in the model compared with the research draft

- `virtual` walls: a boundary with no physical wall (lobby into corridor), so the circulation graph never guesses.
- `glazed` on exterior walls: a side the brief says has windows, kept even where no window fits. The gate found that without it a glazed side with no window was lost on the way back.
- Wall ids are derived from geometry (`wall.h4000.0-6000`), so converting the same plan twice gives the same ids.

## Not done yet (deliberately)

- The web app does not use the model. `upgradeSaved` exists and is tested but is not called when the app loads a saved office; wiring it in changes the saved format and should be its own step.
- `core` still uses its rectangle geometry. The polygon predicates agree with it on 2,000 random rectangle pairs each (overlap, shared wall, containment); replacing the callers is the next part of M1.
- Locks are flags on spaces in the model, but the edit engine still reads `Program.locks` and `Program.arrangement`.
- The wasm file has to be passed to `createKernel`. Node reads it from the package; the browser build has not been wired.
- No exports (IFC, DXF, GLB) read the model yet.
