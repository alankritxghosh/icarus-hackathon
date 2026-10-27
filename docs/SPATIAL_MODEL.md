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

### The finding, and the fix

The first gate run (`gate-run1.json`) found one thing the adapter did not cause. The layout engine works in floating point, and the desk-row count in `furnish/kits.ts` was an exact `floor` of the room depth. Snapping a plan to the millimetre grid, with no model involved, changed what the engine measured in **1 of 110 plans**: a workspace 5.57314 m deep became 5.573 m and lost a seat (8 to 7), adding a `seats_short` failure.

The first fix I tried, snapping the layout output at the source, changed the wording of one refusal reason in a core test (same refusal, different true reason), and the gate says core's tests pass unchanged, so I backed it out (`snapPlanToMm` stays in core as a utility). The fix that stayed is narrower: desk-row counting now treats a fit within one millimetre as a fit (`FIT_TOLERANCE_M` in `kits.ts`). A plan more than a millimetre from a threshold behaves exactly as before. The second gate run (`gate-run2.json`) shows: core's 172 tests unchanged, both evaluation sets reproduce their recorded results exactly, and the grid sensitivity is **0 of 110**. The gate now requires zero.

Limits: this fixes the one knife-edge found. Other exact comparisons in the furnishing code (placement uses a 1e-6 m tolerance) could still hide others on plans the sets do not contain; the gate would catch them on these sets only.

## What changed in the model compared with the research draft

- `virtual` walls: a boundary with no physical wall (lobby into corridor), so the circulation graph never guesses.
- `glazed` on exterior walls: a side the brief says has windows, kept even where no window fits. The gate found that without it a glazed side with no window was lost on the way back.
- Wall ids are derived from geometry (`wall.h4000.0-6000`), so converting the same plan twice gives the same ids.

## In the app

The web store (`apps/web/src/store.ts`) now upgrades every saved office on load and on save: it adds `version: 2` and a `model` derived from the plan. The model is regenerated each time, never trusted from storage, so it cannot go stale after an edit (a test fails if it does). The app still reads the plan. A save whose plan cannot be converted is kept as it was, without a model, instead of being dropped. The browser imports only `@icarus/spatial/model`, which leaves out the Clipper2 kernel; the production bundle contains none of it.

### What the person sees

Nothing new to learn: two lines join the existing "What was measured" list, and two buttons sit under Make it real and Edit.

- **Drawing check** and **Where the sizes come from** (from `modelEvidence`). The first says whether the drawing is consistent (no overlaps, every door and window on its wall, every room reachable) and names the first problem if not. The second says "Designed by Icarus: exact in the drawing, nothing surveyed on site, wall structure not engineered", and would instead warn about estimates and unknown structure once a model holds scanned data. The Clipper2 kernel loads on first use (a 39 KB chunk and a 183 KB wasm file), so the page that asks for a brief does not download it.
- **3D model (.glb)**: the office as seen, from the viewer (ground, plan-view labels and hidden parts left out). **Plan (.dxf)**: a CAD drawing built from the model, with layers for spaces, walls, doors, windows, columns and labels, in millimetres, upright.

Checked in a real browser (Vite dev server, not just tests): an office built, both lines appeared (so the kernel and wasm loaded), both buttons produced files with the right names, no console errors. The DXF opened in `ezdxf` (a widely used CAD library) with zero audit errors, the right entity counts (13 spaces, 39 physical walls, 12 doors, 13 windows) and the right extents. The GLB is a valid glTF 2.0 file whose header length matches its size (520 nodes, 408 meshes, 35 materials, 26 images). It is large (about 14 MB, mostly embedded textures and the CC0 models); it was not validated with the Khronos validator or opened in a second 3D program.

DXF limits: walls are drawn as closed outlines of their thickness, curved walls as their centre line only, and doors and windows on curved walls are left out (reported in `skipped`). The format is AutoCAD release 12, chosen because every program reads it; it carries no 3D, no door swings and no furniture.

## Editing by words, on the model

`editModel(state, ops)` in `src/edit.ts` takes `{ program, model, seed }` and returns the same shape plus core's account of each operation. The app's "Change it with words" now goes through it, and each built office carries its model (`Built.model`).

What moved: before, the edit engine was handed an evaluation held at the plan's stored row order (`plan.search.rows`, solver bookkeeping) and the locks in `Program.locks`. Now the row order is read back from the model's geometry (`arrangementOf` in core, which reverses the layout engine's frame), a lock is a flag plus an anchor on the space (`lockAt`, the room's position when locked, so drift stays bounded across edits), and the result comes back as a model. A model the row engine did not make (curves, columns, rooms moved by hand) is refused with a reason instead of being edited wrongly.

What did not move: the measuring, the candidate search and the plain-language refusals are still core's `applyEdit`, unchanged. The model path is a different input and output for the same engine, which is why it can be gated on equality.

The gate (`gate-run3.json`) checks that editing on the model equals editing directly: **all 158 requests** give identical step messages, changed flag, resulting plan (to a nanometre), cost, issues and resulting model; **72 chains of four requests** with locks and unlocks in them give identical results at every step; the rows read back from geometry equal the stored rows on every base and edited plan; and the model path starts with no stored row order at all. Core's tests (172 existing, plus 5 new for `arrangementOf`) pass; both evaluation sets reproduce exactly. Breaking `editModel` (dropping locks) made the gate fail with 74 differences; resetting the lock anchor, always replacing the state, and reading rows in the wrong order were each caught by tests.

Checked in the browser: move, "already there", lock, a refused move of a locked room, and undo (the lock chip goes, the office returns), with the drawing check still passing on the edited model and no console errors.

Limits: each edit still re-plans every candidate with the row engine, so a model can only be edited if the row engine could have made it; the word editor does not yet move rooms in an L-shape or around a column. Undo keeps whole snapshots of the office in memory, as before.

## Not done yet (deliberately)

- `core` still uses its rectangle geometry. The polygon predicates agree with it on 2,000 random rectangle pairs each (overlap, shared wall, containment); replacing the callers is the next part of M1.
- A building-shape picker (L-shape) waits for a layout engine that can design one; the model and kernel can hold it, the row engine cannot.
- The wasm file has to be passed to `createKernel`. Node reads it from the package; the browser build has not been wired.
- No exports (IFC, DXF, GLB) read the model yet.
