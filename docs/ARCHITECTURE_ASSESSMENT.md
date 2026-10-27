# Icarus architecture assessment

Status: first assessment, written 27 October 2026. It judges the current code against the product we want, not against the hackathon timeline.

## How to read this

Every claim carries one of three labels.

- **Read in code**: I opened the file and counted or read it.
- **From research**: a web search result this session. Search excerpts are secondary sources; I did not read the full papers. Where a search came back empty, I say so.
- **Judgment**: my engineering opinion or estimate. Estimates are not measurements.

Cost figures are person-time estimates for one engineer working with an AI pair. They are for planning, not promises.

## The product we are assessing against

A system that understands a spatial environment well enough to:

1. generate it from natural language,
2. reason about its constraints and explain them,
3. optimise it and compare alternatives,
4. change it without breaking unrelated parts,
5. reconstruct existing environments as input,
6. show it in several representations (plan, 3D, photographic, exports, spatial computing).

The current product does 1 to 4 for rectangular offices, 6 partly, and 5 only as a paused experiment.

## 1. What is fundamentally sound

These are the parts to keep, because they are about method, not about rectangles.

| Part | Evidence | Why it is sound |
|---|---|---|
| Spatial knowledge as data (`knowledge/office.v1.json`, with a `references` list and a scope statement that it is not code) | Read in code | Rules are versioned, inspectable and separable from logic. This is the seed of a rule pack. |
| Models speak only closed schemas (`ProposalSchema`, `PatchSchema`, `EditSchema`) | Read in code | The model proposes, deterministic code decides. This matches how the Holodeck line of work uses an LLM: the LLM proposes relations and a solver places things, and Holodeck 2.0 feeds solver failures back to the model (From research). |
| Measure before accepting (`evaluateProgram`, `introduced()`, the lock check) | Read in code | An edit is kept only if the measured result is no worse. This is the property that makes natural-language editing safe, and it does not depend on geometry type. |
| Seeded, reproducible search (`rng(seed)`, `FloorPlan.search`) | Read in code | Same input, same plan. Needed for tests, bug reports and trust. |
| Pure core with portable contracts (`packages/core` has no UI or network code) | Read in code | Workers, edge and web all reuse it. |
| zod validation at every boundary | Read in code | External data is checked before use. |
| Flat scene list (`SceneNode[]`) mapping to three.js and GLB | Read in code | A neutral render representation. |
| Evaluation corpora (12 design briefs, 158 edit requests) and mutation-checked tests | Read in code and measured earlier | A regression harness we can reuse across a rewrite. This is worth as much as the code. |
| Honesty rules (concept only, no code claims) | Read in code | Needed for any product that touches buildings. |

## 2. Temporary: correct for now, will be outgrown

**Rectangles and rows are baked into the data model, not just the solver.** Counts from the code:

- `geometry.ts` is entirely axis-aligned `Rect` maths (`overlapArea`, `sharedEdge`, `facingSpan`, `exposureOnSide`).
- `PlanRoom.rect` is a `Rect`. Fields named `.rect` are read in `build` (8 places), `furnish` (17), `repair` (15) and `edit` (14). The `Rect` type itself appears in `layout` (17) and `furnish` (15).
- The shell is `{ w, h }` with an `entrance` and `windows` as sides. A wall run is derived from room edges plus the perimeter (`build/walls.ts`).
- `layout/realize.ts` turns a list of rows into rectangles: row depth proportional to row area, room widths proportional to target area, one lobby column on the entrance side, corridors between rows.
- `layout/frame.ts` rotates every plan into a canonical frame so the entrance is always on one side.

**The user's data holds the solver's internal representation.** `Program.arrangement` is `string[][]`, the row order. `Program.locks` stores centre points in the canonical frame. The word "rows" appears 30 times in `edit` and 36 in `layout`. If rows go away, saved offices need migrating. This is a design leak, and the most important thing to fix early.

**The search space is narrow.** Simulated annealing permutes room order across a few rows (`layout/search.ts`). It cannot invent a non-row topology, an L-shape, or a courtyard. That is why swaps with reception in the same row are refused: the layout has no other way to satisfy "reception at the entrance."

**The optimiser and the judge share their definitions.** The search cost (`layout/cost.ts`) and the repair score (`diagnose` + `issueCost`) are both ours and are hand-weighted. The earlier result (rules 655, repair loop 371, minus 43%) is real, but it measures improvement on our own metric. It does not show that the plans are better to an architect. This is not a bug; it is a limit on what we may claim.

**Edits are written op by op.** `edit/apply.ts` is 722 lines, each op with its own candidate generation and intent check. Adding a room type or a rule means touching several branches.

**Scenes are boxes, cylinders and a few CC0 assets.** Walls are box segments. There is no wall thickness model beyond that, no wall type (structural or partition), no openings as first-class objects (doors live on `PlanRoom`, windows are whole shell sides).

**Single level, no structure.** No columns, cores, shafts, levels or services.

**Repaint is not tied to the geometry.** "Make it real" sends a render to an image model; nothing checks that the result keeps the layout.

## 3. What needs to be redesigned

### 3.1 A building model that is not a list of rectangles

Replace `FloorPlan { shell, rooms[].rect, circulation[] }` with a spatial model that has stable ids and is serialisable and versioned:

- `Level`: elevation, height, boundary polygon (with holes).
- `Space`: a polygon (with holes), a kind, a programme (capacity, equipment), and links to its walls.
- `Wall`: a segment with thickness, a type (exterior, structural, partition), and its two adjacent spaces.
- `Opening`: a door or window, hosted on a wall at an offset, with width and sill.
- `Obstacle`: columns and cores, as polygons that spaces must avoid.
- `Circulation`: a graph of nodes and edges over the spaces, not a rectangle list.
- `Item`: furniture and fixtures with a footprint, a clear zone and anchoring rules.

Use coordinates snapped to a fixed unit (for example millimetres as integers) so equality and adjacency checks are exact. This replaces the `EPS = 1e-6` comparisons now in `geometry.ts`. (Judgment.)

Use IFC's vocabulary for names (space, wall, opening, column) so export is a mapping, not a translation (Judgment).

### 3.2 One constraint model, used by both generation and validation

Today `cost.ts` (search) and `diagnose.ts` (validation) overlap but are separate. Define constraints once, each with: a measure, a tier (hard, soft, user preference), a plain-language explanation, and a suggested repair. The solver minimises soft terms subject to hard ones; the validator reports the same terms; the edit engine uses both. This is what makes "override a soft rule with a stated consequence" possible and "never block an exit" non-negotiable.

### 3.3 Generators as plug-ins

Define `Generator(program, model-boundary, constraints, seed) -> candidates`. The current row generator becomes generator number one. It stays the baseline: any new generator must match or beat it on rectangles using the existing evaluation corpus before it is used.

### 3.4 Edits as transactions

An edit is a typed operation with preconditions, producing a patch on the spatial model. The engine validates, accepts or refuses with a reason, and stores the inverse. Undo and locks become properties of the model (locked space ids and tolerances) rather than centre points in a canonical frame. Ops should be data (name, parameters, preconditions, affected objects) so adding a room type does not mean writing a new branch.

### 3.5 Room kinds as definitions

Move the closed enum to a registry: area rule, capacity, furniture requirements, adjacency, daylight, access, lockable. The model asks for a room; geometry decides if it fits. This already half-exists in `office.v1.json`.

### 3.6 Render path anchored to geometry

Render the model to buffers the image model can be conditioned on (depth, edges, labels), then compare the output against the buffers. Current practice for this exists in the image-generation world, but I did not verify specific tools this session (Judgment, to research).

## 4. Technologies, algorithms and libraries to investigate

Status key: **R** = researched this session, **K** = I know of it from background but did not verify this session, **?** = not yet looked at.

### Geometry kernel and representation

- **Clipper2 (polygon boolean, offset, simplify).** Upstream is C++ with a documented release 1.4.0 (R). A WebAssembly port, `clipper2-wasm`, exists on npm at version 0.2.1 under BSL-1.0 (R). Its maturity is unverified. Fit: wall offsets, room-boundary clipping, containment tests.
- **Straight skeleton / medial axis** for corridor placement and room splitting: CGAL has a straight-skeleton package (K). The search did not return anything on it, and whether a usable WASM or JS route exists is unknown (?).
- **JTS / Shapely / Turf** as an alternative to Clipper2 for validity predicates (K, to compare).
- **Exact predicates** or integer coordinates to avoid tolerance bugs (Judgment).

### Layout synthesis and optimisation

- **Constraint programming (OR-Tools CP-SAT).** The CP-SAT model proto includes a `NoOverlap2D` constraint (R). The search found no architectural floor-plan examples with it (R, gap). The closest analogue found was constraint-programming floorplanning for VLSI test sites, with fixing and grouping constraints (R). Fit for us is a judgment: good for rectangle-ish packing with exact hard constraints; unclear for general polygons. It would run in the Python worker, not the browser.
- **Z3 / MiniZinc / MIQP** as alternatives (K, to compare).
- **Hierarchical subdivision** (BSP, guillotine cuts, treemaps) on polygons, with local search on top, as the likeliest first polygon generator (Judgment). It generalises the current rows idea.
- **Multi-objective search** (Pareto front over daylight, circulation, capacity, collaboration) to produce several scored alternatives rather than one answer (Judgment).
- **Learned generators.** HouseDiffusion denoises room and door corner coordinates, supports non-Manhattan shapes, and is conditioned on a room graph; its authors report House-GAN++ often produced duplicate or missing rooms; a 2025 review flags overlapping rooms and artefacts in HouseDiffusion output (R). GSDiff and a markup-based follow-up exist (R, titles only). They are trained on residential data; I did not verify the dataset licence or whether any office dataset exists (?). Treat them as sources of ideas, and as possible proposers whose output our validator gates, not as the core.
- **LLM as relation proposer, solver as placer.** Holodeck uses ten relation types and a hard/soft constraint split, relaxing soft ones on conflict (R). Another 2025 line argues the LLM should write a placement program instead (R). Our current design is closer to the first. Worth comparing on interior layout (furniture) where we currently use hand-built kits.

### Representation for language and reconstruction

- **SceneScript (Meta Reality Labs).** An autoregressive model emits a sequence of structured commands describing a scene; it reports state-of-the-art architectural layout estimation, works from point clouds or posed images, and can be extended with new commands. Trained on Aria Synthetic Environments (100,000 scenes); weights made available to academic researchers in September 2024 (R). Two uses for us: (1) as a design pattern for a command language for spaces, which is what our `Edit` ops already are; (2) as a possible scan front end. Licence and fitness for our use are unchecked.
- **Panorama layout estimation (HorizonNet, LGT-Net).** Both predict room layout from a single panorama: HorizonNet uses three 1D vectors per image column with fast post-processing; LGT-Net predicts horizon-depth and room height (R). Whether outputs are metric is unconfirmed from the search (R, gap).
- **Multi-view reconstruction (VGGT, MASt3R, DUSt3R) and metric depth (MoGe-2).** The search returned nothing; we already ran MoGe-2 in the paused worker (from earlier in this project). Metric scale from monocular input is the central weakness and needs a measured study (?).
- **Apple RoomPlan.** iOS API using LiDAR that returns walls, doors, windows and furniture with dimensions, per the research pasted by the user (not independently verified this session). It is iOS-only, so it is a capture path, not a server path (Judgment).

### Exports and spatial computing

- **IFC.** `web-ifc` is a WebAssembly library to read and write IFC; its README marks it pre-alpha, and I found no example of writing a model from scratch (R). IfcOpenShell is an established Python toolkit; the search did not confirm its authoring API, so verify before relying on it (K, to verify). A Python IFC writer in the Modal worker is the likelier route.
- **GLB/glTF** is already produced (Read in code, via the scene list).
- **OpenUSD** is described as a scene-level format and glTF as the lighter asset format; browser support for USD was weak in the sources found, which are mostly 2023 to 2024 and vendor or forum opinion (R, dated). Quest support not established.
- **DXF/DWG, PDF** for drawings: DXF is simple to write for plans (Judgment).
- **WebXR** for walk-through on headsets: not researched.

### Compliance

- Research on automated code checking splits into two steps: turn regulation text into computable rules, and prepare building data to run them. LLMs are used for the first step (interpretation, generating checks, including Revit-script generation); the geometric check itself runs on conventional BIM tooling (R). That supports the stance we already take: the LLM may help author a rule, the deterministic checker decides.
- I did not find anything on Solibri's rule engine, Singapore's CORENET X, or ifcOWL in this session (?).

## 5. Hardest unsolved problems

1. **Defining "good."** There is no ground truth for a good office. Our score is hand-weighted and shared by optimiser and judge. We need an independent evaluation: expert-rated pairwise comparisons, and published plans to test against. Without it we cannot claim quality, and a learned objective is not possible. This is the first research task, because every other optimisation claim rests on it.
2. **General polygon layout with real circulation.** Packing rooms in an irregular boundary, with corridors that form a connected, navigable graph and meet egress-style rules, is much harder than rows. Known pieces exist; the combination for offices at our quality bar is not something I found as a solved off-the-shelf system.
3. **Edit locality.** "Make the kitchen bigger" must change the kitchen and what it forces, and nothing else. We handle this with measure-and-compare on a narrow vocabulary. Doing it on a general model, with ambiguous language, is open.
4. **Metric reconstruction from photographs.** One photograph cannot determine depth, hidden walls, or whether a wall is structural. Panoramas and multi-view help; LiDAR is far more reliable. How accurate we can get from phone photos, and how to show uncertainty to the user, needs measurement.
5. **Geometry-faithful photorealism.** Image models invent detail. Constraining them to the model's layout and verifying the result automatically is open.
6. **Furniture and fixtures at fine scale** in arbitrary shapes, with clearances, accessibility and acoustic privacy.
7. **Jurisdiction-specific compliance.** Rules differ by place and change; legal interpretation and sign-off belong to qualified people.
8. **Multi-level buildings, structure, services.** Each is a separate discipline.

## 6. Ideal architecture

```
Inputs        brief (text/voice)   existing building (scan, photos)   sketch / DXF / IFC
                  |                         |                              |
Interpretation   LLM proposes only in closed schemas  ->  validated Program + Site (boundary, obstacles)
                                                                |
Spatial model    Levels, Spaces, Walls, Openings, Obstacles, Circulation graph, Items
(one source      stable ids, integer units, versioned schema, IFC-aligned names
of truth)                                                       |
Constraints      hard / soft / user tiers, each with measure + explanation + repair
                                                                |
Generators       row generator (baseline) | polygon subdivision | CP-SAT | learned proposers
                 -> candidates -> scored by the constraint model -> ranked alternatives
                                                                |
Edit engine      typed ops -> patch -> validate -> accept/refuse with reason -> inverse for undo
                                                                |
Projections      plan | 3D scene | GLB | IFC | DXF/PDF | USD | geometry buffers for repaint
                                                                |
Surfaces         web app | walk-in view | headset (WebXR) | API
```

Rules for the architecture:

- Models never write geometry. They write requests in closed schemas.
- Everything that can be checked is checked by deterministic code, and the checker's output is what the user sees.
- Every result is reproducible from (input, seed, version).
- Every generator and every rule pack is evaluated on the same corpus, and a change is accepted only if the numbers do not regress.

## 7. Migration without throwing work away

Strangler pattern: build the new model beside the old one, bridge them with an adapter, move one layer at a time, and keep the current tests and evaluation corpora as the safety net. At no step do both the old and new app stop working.

| Step | Work | Keeps | Safety check | Estimate (Judgment) |
|---|---|---|---|---|
| M0 | Define the spatial-model schema and an adapter `FloorPlan <-> SpatialModel`. Add a model version to saved offices and a migration for `arrangement` and `locks`. | All current code | Round-trip tests on every fixture; all 172 core tests pass unchanged | 1 to 2 weeks |
| M1 | Polygon geometry kernel. Rewrite `geometry.ts` functions over polygons with integer units; keep `Rect` as a special case. | Callers, via the adapter | Differential tests: new functions equal the rectangle versions on random rectangles | 2 to 3 weeks |
| M2 | Constraint registry. Express `diagnose` and `planCost` terms as declared constraints with tiers. | Numbers | The 12-brief evaluation reproduces the same issue scores | 2 weeks |
| M3 | Generator interface; wrap the row generator; build a polygon generator as a research spike. | Row generator as baseline | On rectangles, the new generator must not score worse than the baseline on the corpus | 4 to 8 weeks, with real uncertainty |
| M4 | Edit ops as data over model transactions; port locks to space ids. | Grammar, model path, `introduced()` logic, 45 tests | The 158-request evaluation: no new failures introduced, applied/refused counts do not drop | 3 to 4 weeks |
| M5 | Exports and inputs: IFC spaces and walls, DXF plan, boundary import from a scan or DXF, geometry-conditioned repaint. | Everything above | Open exported files in an independent viewer; compare imported areas to the source | 4 to 8 weeks |
| M6 | Independent quality evaluation: expert ratings, published-plan comparison. Start this early and in parallel with M1. | n/a | Defines what "better" means for M3 onward | Ongoing; first useful result in 2 to 4 weeks |

Rough total for M0 to M5: 4 to 6 months of focused work (Judgment, wide error bars; M3 and M5 are the uncertain ones).

What carries over unchanged: `knowledge/` data, zod schemas for model boundaries, the propose/repair loop, the edit grammar and its tests, the evaluation corpora, seeded RNG, furniture kits (retargeted to polygon spaces), the web app shell, the edge worker.

What gets replaced: `geometry.ts` internals, `layout/realize.ts`, `layout/frame.ts`, the `rows` form of `arrangement`, `build/walls.ts` wall derivation, centre-point locks.

## 8. Build, research, or beyond reach

**We can build now (known techniques; mainly engineering time):**
- Spatial model v2 with polygon boundaries, openings on wall segments, columns as obstacles.
- Integer-unit geometry kernel and differential tests.
- Constraint registry with hard/soft/user tiers and overridable soft rules.
- Room-kind registry so any room type can be added or removed.
- Several scored alternatives per brief (multi-objective ranking over the existing generator).
- GLB, DXF and PDF plan export; a basic IFC export of spaces and walls (verify the library route first).
- Boundary import from DXF or a LiDAR scan result.

**Needs serious research (outcome uncertain):**
- A polygon layout generator that matches the row generator on rectangles and beats it elsewhere.
- Circulation synthesis as a graph with measurable egress-style properties.
- An independent measure of layout quality, and a learned objective if the data exists.
- Geometry-faithful photoreal repaint with automatic verification.
- Metric reconstruction from phone photos, and honest uncertainty reporting.
- Reliable translation from free-form language to closed edit ops beyond today's vocabulary.
- Using a command-language model such as SceneScript as a scan front end (licence and fit unknown).

**Currently beyond our practical capabilities (or not ours to claim):**
- Certified building-code compliance. Requires jurisdiction-specific rules, legal interpretation and qualified sign-off. We can build explainable checks for named, measurable rules and label them "not a compliance finding."
- Parity with Revit or ArchiCAD authoring.
- Structural, mechanical, electrical and fire-engineering design.
- A foundation model for space trained on data we do not have.
- Guaranteed geometric fidelity from a generative image model.

## 9. Recommended order

1. **M6 first, in parallel with M0**: an independent quality measure. Everything else is optimisation against a number we currently define ourselves.
2. **M0 and M1**: the model and geometry kernel. They unblock every other item and are mostly known engineering.
3. **M2 and M4**: constraints and edits on the new model, so the product keeps its safety properties as geometry generalises.
4. **M3**: the polygon generator, as a measured research spike against the baseline.
5. **M5**: exports and scan input, once the model can hold a real building.

## 10. Open questions for the founder

- Who is the first real user, and what building do they have? Their first irregular plan decides which polygon features come first (L-shape, columns, angled wall).
- Is a human architect available to rate layouts for M6? One or two reviewers would be enough to start.
- Which jurisdiction matters first, if any compliance feature is wanted?
- Is a native iOS capture path (RoomPlan) acceptable, or must scanning work from a browser or any phone camera?

## 11. What this assessment did not check

- I did not benchmark any library. Library maturity statements come from search excerpts and READMEs, which are secondary.
- I did not read the full text of any paper cited.
- The migration estimates are my judgment and have not been tested by a spike.
- I did not look at the paused reconstruction worker in this pass.

## Sources (from this session's searches)

- SceneScript: https://ai.meta.com/blog/scenescript-3d-scene-reconstruction-reality-labs-research/ and https://arxiv.org/abs/2403.13064
- Holodeck: https://arxiv.org/pdf/2312.09067 ; Holodeck 2.0: https://arxiv.org/pdf/2508.05899 ; LLM-writes-a-program alternative: https://arxiv.org/pdf/2504.05482v2
- HouseDiffusion: https://ar5iv.labs.arxiv.org/html/2211.13287 ; layout-generation review: https://arxiv.org/pdf/2504.09694 ; GSDiff: https://arxiv.org/pdf/2408.16258
- LGT-Net: https://arxiv.org/pdf/2203.01824 ; HorizonNet: https://openaccess.thecvf.com/content_CVPR_2019/html/Sun_HorizonNet_Learning_Room_Layout_With_1D_Representation_and_Pano_Stretch_CVPR_2019_paper.html
- web-ifc: https://github.com/ifcjs/web-ifc
- Clipper2: https://angusj.com/clipper2/Docs/Overview.htm ; clipper2-wasm: https://www.jsdelivr.com/package/npm/clipper2-wasm
- LLMs for building-regulation interpretation: https://arxiv.org/pdf/2407.21060 ; gen-AI in building research review: https://arxiv.org/pdf/2410.01098
- OpenUSD and glTF context: https://www.hpcwire.com/aiwire/2023/08/03/3d-internet-building-block-championed-by-nvidia-and-apple-faces-challenges/
