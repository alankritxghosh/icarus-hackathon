# Research round 2: validating the architecture before committing

Written 27 October 2026, after [ARCHITECTURE_ASSESSMENT.md](ARCHITECTURE_ASSESSMENT.md). That document proposed a direction. This one tests the uncertain parts with code and measurements, and corrects the first document where the evidence disagrees.

All code is in `research/` and is throwaway: nothing in `packages/` or `apps/` changed, and `research/` is excluded from lint. Raw results are in `research/results/`.

## How to read this

- **Measured** means I ran code and the number is in `research/results/`.
- **Read** means I read a primary source (an arXiv page or project page) through the fetch tool, which returns excerpts, not the whole paper.
- **Search** means a search-result summary I did not open further.
- **Judgment** is my opinion.

## Summary: what changed since the first assessment

| Question | Finding | Effect on the plan |
|---|---|---|
| Is a polygon kernel a risk? | Low risk. Three libraries were exact on every grid test; the real differences are in degenerate input, float noise and offsetting. | Choose Clipper2 on an integer-millimetre model. Risk moves to packaging, not correctness. |
| Can a solver lay rooms out in a non-rectangular floor? | Yes, at this scale. CP-SAT placed the same programs in an L-shape with no change to the model except one obstacle rectangle. | Polygon generation is feasible. Scaling past about 14 rooms is not shown. |
| Did CP-SAT beat the current row engine? | No honest answer yet. It wins on some independent metrics and loses on others; weights are mine. | Do not claim superiority. The architect benchmark is what decides. |
| Is geometric connectivity the same as usable circulation? | No, measured. A door-and-wall graph called all four test plans reachable; a clear-route test failed two of them. | Circulation needs two layers: topology and clearance. |
| Can the v2 model hold today's plans? | Yes. All 12 real baseline plans convert, validate with zero errors and are fully door-reachable. Curves, columns, two levels and uncertainty are expressible. | The M0 adapter is feasible. |
| Is rectangle-only a weakness against the state of the art? | Less than I implied. Holodeck's floor plans are also rectangles, proposed by GPT-4. | Polygon support is a differentiator, not a catch-up item. |
| Are my 4-6 month figures reliable? | No. They were a hypothesis. Revised ranges below say which parts the spikes firmed up and which they did not. | See section 9. |

## 1. Polygon geometry kernels (measured)

Spike: `research/spikes/kernel/`. Three libraries behind one interface, all coordinates integer millimetres, Node 24.

| Library | Version | Licence | Type |
|---|---|---|---|
| polygon-clipping | 0.15.7 | MIT | pure JS, float coordinates, robust predicates |
| JSTS | 2.12.1 | EDL-1.0 or EPL-1.0 | JTS port, float coordinates |
| clipper2-wasm | 0.2.1 | BSL-1.0 | Clipper2 compiled to WebAssembly, integer coordinates |

Results (`research/results/kernel.json`):

| Test | polygon-clipping | JSTS | Clipper2 |
|---|---|---|---|
| 3000 random rectangle pairs: union, intersection, difference vs analytic area | exact | exact | exact |
| 1500 grid-fuzz shape pairs, area(A∪B) = area(A)+area(B)−area(A∩B) | 0 violations | 0 | 0 |
| 36 abutting rooms unioned: polygons, vertices left (ideal 1 and 4) | 1, 4 | 1, 24 | 1, 24 |
| Shared wall vs 1 mm gap kept distinct | yes | yes | yes |
| Shared wall with 1e-6 mm of float noise (want one polygon) | **2** | **2** | 1 |
| Room minus a 1 m column: area and rings | exact, 2 | exact, 2 | exact, 2 |
| Duplicate and collinear vertices | ok | ok | ok |
| Zero-width spike; self-crossing bow-tie | ok | **threw** ("found non-noded intersection") | ok |
| Offset an L-shaped room ±100 mm vs hand-computed area | no offset function | exact | exact |
| Deflate a 150 mm strip by 100 mm gives empty | n/a | yes | yes |
| 20,000 rectangle intersections | 120 ms | 470 ms | 155 ms |
| 5,000 L-shape minus room | 70 ms | 131 ms | 72 ms |
| 200 offsets of a 400-vertex polygon | n/a | 244 ms | 204 ms |

What this says:

1. **Correctness on clean input is a non-differentiator.** Every library is exact. Speed is fine: a layout search evaluating thousands of candidates is not bound by any of them.
2. **Float noise is the real hazard, and integer coordinates remove it.** Two rooms whose shared wall differs by one nanometre split into two polygons in both float libraries and merge in Clipper2. The model should store integer millimetres (as the draft v2 schema does) and snap on the way in.
3. **JSTS is brittle on degenerate input.** It threw on a zero-width spike and on a self-crossing ring. Real scan or user-drawn data contains those, so every ring needs cleaning before JSTS sees it.
4. **Clipper2 and JSTS both leave collinear vertices after a union** (24 instead of 4); a simplify step is needed. polygon-clipping merges them.
5. **Packaging is the cost.** The `clipper2-wasm` build assumes a browser and fetches its `.wasm` by URL; in Node the binary has to be passed in (the spike does this). It is a third-party port of Angus Johnson's C++ library, not the upstream project, and the upstream documents release 1.4.0 (search). Its maintenance pace is unchecked. Compiling Clipper2 ourselves from the upstream source is the fallback; I did not test that.

Limits: small inputs (up to 400 vertices), axis-aligned room tests, arcs not tested here (the schema spike flattens them before use), one machine.

**Recommendation (judgment):** integer-millimetre model, Clipper2 for boolean and offset, polygon-clipping as an independent cross-check in tests (it agreed with Clipper2 on every case). JSTS only if a predicate we need is missing elsewhere.

## 2. Layout generation: CP-SAT, mixed-integer, subdivision

Spikes: `research/spikes/layout/`. Same inputs for every generator: the 12 evaluation briefs exported from the real engine (`research/spikes/export/`), with their room targets and rules.

Because my first generator needs a corridor skeleton as an input, both new generators take the same one: an entrance lobby strip on the west wall plus one corridor spine. That limits the comparison to the 7 briefs with a west entrance, and CP-SAT found 6 of them feasible (below).

### 2.1 Independent metrics

`research/spikes/layout/metrics.py` scores any plan: area deviation from target, undersized rooms (below the kind's `minScale`), aspect and minimum-side violations, daylight, adjacency wishes met, reachability, travel distance from the front door, share of floor left free, overlaps. It was written separately from the TypeScript cost and `diagnose` code, with the same rules read from the knowledge file. It is a second implementation by the same author, so independence is partial.

### 2.2 CP-SAT model

Rooms are integer rectangles in decimetres. `NoOverlap2D` keeps them apart and out of fixed obstacles (lobby, corridor spine, and for the L the missing corner). Area target, aspect, minimum side, door frontage on circulation, daylight along window walls and adjacency wishes are expressed as constraints and weighted objective terms. Minimum side and aspect are soft after the first run came back INFEASIBLE on a tight brief: hard rules make tight programs unsolvable, so they must degrade with a measured penalty.

Findings:

- **Non-rectangular floors cost one line.** The L-shaped floor (same floor area as the rectangle) uses the identical model plus the notch as an obstacle. Every L solution had zero overlap and zero area outside the shell.
- **Time to a proven optimum varied a lot.** On the first run, 4 of 6 L-shaped problems and 3 of 6 rectangular problems were proven optimal within 0.4 to 1.9 s; the harder ones (demo studio rectangle, the two tight briefs) stopped at the 30 s limit with a large gap between the best solution found and the bound (for example 204,138 against 73,920). That is the scaling warning: 11 to 14 rooms is already at the edge of what this encoding proves quickly.
- **An honest infeasible answer.** One brief (small studio, 8 people) returned INFEASIBLE immediately: its rooms need 103.6 m² and the default shell is 73.5 m². The row engine "solves" it by shrinking every room (the open workspace to about 16 m² of a 48 m² target). Both behaviours have a place: refuse with a reason, or degrade and say so. The model should choose per tier of constraint, not by accident.
- **Reproducibility.** CP-SAT with eight worker threads is not bit-for-bit deterministic, so I ran the whole set twice (`research/results/cpsat-reproducibility.json`). All 14 problem statuses were identical (optimal, feasible-at-limit, infeasible). Proven-optimal objectives were identical to the unit. The three problems that hit the time limit differed in best objective by 4% (demo studio, rectangle), 0.4% (agency 40, rectangle) and 0% (the rest). So optimal answers are stable and time-limited answers are not, which matters for "same input, same plan": a product using CP-SAT would need a single worker thread and a fixed seed, or to store the solution it showed the user.

### 2.3 Subdivision

Recursive axis-aligned cuts of the free floor, with random-order search. First attempt: **zero valid plans on the L-shape (for example 0 of 2,069 tries on one brief)**, because the free floor after carving the corridor is itself L-shaped and a straight cut produces non-rectangular pieces. Adding a rectilinear decomposition step fixed it (about 30 to 450 candidates per 10 s, limited by the cost of the metric code). This is a real design requirement for any polygon generator, not a bug in the spike.

### 2.4 Comparison (6 briefs, west entrance, same metrics)

From `research/results/layout-summary.json`. "Baseline" is today's row engine. CP-SAT ran 30 s per problem.

| Generator | Mean area deviation | Undersized rooms/plan | Aspect violations/plan | Min-side violations/plan | Adjacency wishes met | Rooms lit | Unreachable rooms/plan | Free floor |
|---|---|---|---|---|---|---|---|---|
| Baseline rows (rectangle) | 0.28 | 2.5 | 0.7 | **0.2** | 96% | **74%** | 0 | 19% |
| CP-SAT (rectangle) | **0.08** | **1.5** | 1.0 | 2.3 | **100%** | 55% | 0 | 29% |
| Subdivision (rectangle) | 0.49 | 1.5 | 0.8 | 2.0 | 62% | 66% | 1.7 | 19% |
| CP-SAT (L-shape) | 0.09 | 2.3 | 0.2 | 0.8 | 96% | 68% | 0 | 29% |
| Subdivision (L-shape) | 0.34 | 2.8 | 2.0 | 3.2 | 60% | 53% | 0.2 | 47% |

CP-SAT is clearly worse than the baseline on rooms that fall below their minimum side (2.3 against 0.2 per plan in the rectangle): the soft penalty I chose was too gentle. That is the kind of trade-off a benchmark and tuned weights would settle.

How not to read this:

- The baseline stretches rooms to fill the floor, which inflates its area deviation; CP-SAT hits targets and leaves more floor uncovered (29% against 19%). Neither is "better" without a view on what unused floor is worth.
- CP-SAT's daylight score is worse in the rectangle (55% against 74%) because my objective weights are crude, not because the method cannot do daylight.
- The objective weights, window caps and the corridor skeleton are my choices, one run, six briefs.
- Subdivision with random search is a weak method here; it shows the L-shape works, not that subdivision is good.

**What the spike does support:** a solver can do non-rectangular floors, can satisfy hard geometry exactly (no overlaps, no escapes), and exposes its own optimality gap, which tells the product when a layout is provably good. It does not show that CP-SAT layouts are better than the current ones.

### 2.5 Mixed-integer programming

Not run. Holodeck's own paper says its constraints are linear and that a MILP solver can replace its depth-first search; its MILP path used Gurobi, a commercial solver (Read). OR-Tools ships open MIP solvers as well; I did not test them. CP-SAT is the better fit for combinatorial placement with Boolean logic, which is what the encoding above needs, so I would spend time on the benchmark before comparing solver families.

## 3. What the research says (SceneScript, Holodeck, and others)

### SceneScript (Read: arXiv abstract and HTML version)

- The scene is a sequence of structured commands: `make_wall(id, a_x, a_y, a_z, b_x, b_y, b_z, height)`, `make_door` and `make_window` (each with the ids of the walls they attach to, a centre position, width and height), and `make_bbox` for objects. Walls are straight and gravity-aligned. Values are quantised to 5 cm tokens.
- It is extensible by adding commands: the paper shows `make_curved_wall` with Bezier control points (token accuracy 0.993 at slack 1, IoU 0.990, on synthetic data) and door states.
- Layout estimation on synthetic data: F1 at 5 cm of 0.903 (lifted features), 0.848 (point cloud) and 0.661 (image only); median wall error about 5 to 7 cm, windows the hardest.
- Training data is simulation only (Aria Synthetic Environments, 100,000 scenes). Weights were made available **for academic researchers**, under a licence agreement; the project page says it is a research project and not used on Quest (Read). That rules out depending on it for a commercial product without separate permission.
- The paper notes the model does not predict a confidence score for each object box (Read), so uncertainty would have to come from elsewhere.

**Use for Icarus:** the design lesson, not the model. Icarus's `Edit` ops are already a structured command language. A scan front end could emit the same kind of commands (walls referenced by id, openings attached to walls, quantised units), which matches the draft schema's wall and opening entities. Accuracy figures here are on synthetic data and are not a forecast for phone photographs.

### Holodeck (Read: arXiv PDF)

- GPT-4 designs the floor plan, doors and windows, picks assets and proposes spatial relations; a solver places objects. **Rooms are rectangles specified by four corners**, and the prompt assumes zero wall thickness.
- Ten relation types in five groups (global, distance, position, alignment, rotation). Relations are soft, collisions and out-of-bounds are hard. Placement is depth-first search with a grid, or a MILP.
- Human evaluation with 680 participants: 64.4% overall preference over a procedural baseline (ProcTHOR) on residential scenes. For layout design, relation-constraints beat LLM-written absolute coordinates, which performed no better than random placement because of collisions and boundary errors.
- Cost about $0.20 and three minutes per room (GPT-4, M1 laptop).

**Use for Icarus:** it confirms the closed-vocabulary, solver-decides design, and gives a blueprint for the interior (furniture) layer, which is Holodeck's actual strength. It also gives a model for the human evaluation (paired comparisons, large panel). It does not offer a polygon floor-plan method.

### Other findings

- **Datasets.** The widely used RPLAN residential dataset is research-only under a restricted-access agreement (Search). I found no public, commercially licensable *office* floor-plan dataset; one thesis used 14 private UK office case studies (Search). Learned floor-plan generators trained on residential data therefore have no direct route to an office product.
- **LLM plus verifiable rewards.** A 2026 paper title, "Generative Floor Plan Design with LLMs via Reinforcement Learning with Verifiable Rewards", describes training LLMs with checkable rewards; a validator like ours is the kind of reward signal it needs. I have not read it.
- **Compliance.** Surveyed work uses LLMs to turn regulation text into computable rules and generate checking scripts; the geometric check itself runs on conventional BIM tooling (Search). This matches our stance.
- **IFC authoring.** IfcOpenShell's Python API can create a blank IFC4 file and entities, and has a `void.add_opening` pattern for wall openings; a forum user reported an opening that did not survive a round trip into Blender, so any export needs an independent re-read (Search). `web-ifc` is read-oriented with pre-alpha status (Search, first assessment).
- **Apple RoomPlan.** `CapturedRoom` is serialisable (`Codable`), with arrays of surfaces (walls, doors, windows, openings), objects and sections, and a `Confidence` type for classification certainty; parametric USD export keeps editable dimensions (Search). The exact field names were not found, so a real scan needs decoding to settle the mapping.

## 4. Circulation, adjacency and openings, mathematically

Spike: `research/spikes/layout/circulation_clearance.py` and `research/spikes/schema/validate.ts`.

Circulation has to be represented at three layers. Each answers a different question, and the first alone is misleading.

1. **Topology (door graph).** Nodes are spaces; an edge is a door, a passage or a virtual (wall-less) boundary between two spaces; connectors join levels. Questions it answers: is every space reachable, how many doors from the entrance, are there cut-vertices (a single door that isolates a wing)? Implemented in `circulationGraph`; tested on 12 real plans, an L-shaped plan and a two-level building. Removing one door produced an unreachable room; removing the stair isolated the whole upper level.
2. **Clearance (geometry).** Erode the free floor by half the required route width and ask what is still connected to the entrance. Implemented in `metrics.py` as a raster walk on 0.1 m cells. Result on four hand-made plans, all with a door on every room (so the topology layer called all four reachable):

   | Plan | Widest clear route reaching every room | Passes 0.9 m |
   |---|---|---|
   | 1.6 m corridor | 1.4 m | yes |
   | 1.2 m corridor | 1.1 m | yes |
   | 0.7 m neck from two cupboards | 0.5 m | **no** |
   | obstacle 0.5 m from a doorway | 0.8 m | **no** |

   The raster method under-reads by 0.1 to 0.2 m (cell size and door-approach tolerance), visible in the first two rows, so it is conservative. Exact clearance should come from polygon offsetting (Clipper2) rather than a grid; the grid is the quick version.
3. **Distance (egress-style).** Walking distance from each room's door to the exit along the clear route. The literature on circulation graphs (Search) says to measure from the *most remote point* of a space, not its centre or door, to get a correct worst-case egress distance, and that skeleton graphs from the medial axis produce spurious edges and detours in open areas. The spike measures distance from the entrance to each room's frontage (mean 4 to 18 m, maximum 33 m across the real briefs). A product claim about travel distance must use the most remote point and a jurisdiction's limit; I made no such claim.

Adjacency is a derived relation, not stored: two spaces are adjacent when they share a wall run of at least a minimum length, or face each other across circulation within a gap (the TypeScript rules use 1.7 m with 1 m overlap; the Python metric uses the same). In the v2 schema this is a query over walls and virtual walls, so it cannot drift from the geometry.

Openings: a door or window is hosted by a wall, positioned by an offset along it and a width, so it cannot float free. The validator rejects openings that run past the wall end or overlap each other on the same wall, and warns on doors narrower than 815 mm (the 2010 ADA door clearance already cited in the knowledge file; a floor, not a compliance claim).

## 5. Draft v2 spatial model (built and tested)

Files: `research/spikes/schema/` (`spatial.ts`, `geometry.ts`, `validate.ts`, `adapter.ts`, `examples.ts`, `schema.test.ts`). Run with `node --test schema.test.ts`: 8 tests, all pass.

Entities: Level, Space (polygon with holes), Wall (straight or curved, left/right spaces, `structural` three-valued), Opening (hosted on a wall), Obstacle (column, core, shaft, retained wall), Connector (stair, lift, ramp, multi-level), Item. All coordinates are integer millimetres. A curve is a DXF-style `bulge` on an edge (tan of a quarter of the included angle), which maps directly to DXF and to IFC arcs. Every geometric entity carries provenance: `stated`, `measured`, `estimated`, `inferred` or `generated`, with a tolerance and confidence. A boundary with no physical wall is a `virtual` wall, because the first conversion attempt showed the current plans use implicit open boundaries between lobby and corridors and the circulation graph needs them explicit.

Examples (all validated):

| Example | What it shows |
|---|---|
| 12 real v1 baseline plans | converted by the adapter: **0 errors, 0 uncovered floor, every room reachable by doors**; between 25 and 52 walls and 7 to 15 doors each |
| L-shaped office from the CP-SAT result, two round columns | non-rectangular level, columns as arc-bounded obstacles, usable area less than gross |
| Floor with a circular conference room | circle from four 90° arcs matches pi r² within 0.2%; curved walls with a door; a curved hole in the surrounding space |
| Two-level building, stair connector | upper level reachable only via the stair (removing it isolates both upper spaces) |
| Room reconstructed from photos | one measured wall (30 mm), two estimated (250 and 300 mm), one inferred with no tolerance, three of four walls structural-unknown |

Negative tests confirm the validator rejects overlapping spaces, openings past the wall end, wrong winding, dangling references, swapped left/right sides, spaces outside the level and self-crossing rings. (Several of these were found by mutating good models, not by assertion alone; the left/right check was added after I noticed my own example had two walls on the wrong sides.)

What the conversion taught us about v1: it has no window objects (windows are whole shell sides), implicit open boundaries, no wall types, and a door per room only. The new model makes each of those explicit.

## 6. Uncertainty

The pasted review is right that this belongs in the model. The schema implements it, and `uncertaintySummary` derives what a view may say:

- `mayShowAsExact` is true only when nothing is estimated, inferred or unquantified. For the reconstructed-room example it is false, and it reports `w.west` as unquantified (an inferred wall with no tolerance), a worst tolerance of 400 mm, and three structural-unknown walls.
- `wallMayBeMoved` is false for a structural wall, for an unknown one, and for an inferred one, so edit advice cannot suggest removing a wall whose nature nobody knows.
- Generated geometry is `generated`: exact by construction, but not verified on site. That distinction should reach the UI ("designed", not "surveyed").

Literature (Search): Sigma-FP models each wall plane as a Gaussian in plane-parameter space and propagates pose uncertainty into a 3D floor plan from an RGB-D camera; a layout-estimation method predicts floor-wall boundary uncertainty and refines uncertain boundaries; skeleton and map-fusion work uses relative-pose uncertainty to reject unreliable fusion. I found no paper combining images, LiDAR, per-wall confidence and scan-to-BIM output. Apple RoomPlan exposes classification confidence but I could not confirm positional tolerance (Search).

Open question that needs a spike with real data: how to *calibrate* a tolerance. A model-reported confidence is not a calibrated error bound. The right test is to scan rooms with known dimensions and compare, which needs a LiDAR device and a tape measure.

## 7. Independent evaluation benchmark

Spike: `research/spikes/benchmark/`.

**Design.**

- **What is rated.** Pairs of plans for the same brief, shown side by side in random order and blinded. The reviewer picks which plan they would rather *start from* (so the question is practical, not aesthetic) and scores each plan 1 to 5 on five dimensions: function, space utilisation, circulation, daylight, furniture usability. Anchors are written in the packet.
- **Who rates.** Practising interior designers or workplace planners (the segment the pasted review recommends); at least 5, ideally 8. Each rates every pair.
- **What is compared.** The current row engine, each new generator, and a human-drawn plan for the same brief as a ceiling. Without the human plan we cannot tell "better than our baseline" from "good".
- **Blinding and bias control.** Side order randomised per pair; page order randomised; generator names never shown; the key is held by the study owner and opened after the ratings are in. Room labels show kind and area only.
- **Analysis.** Preference share with a two-way bootstrap interval (reviewers and briefs both resampled), per-dimension mean differences, reviewer agreement, and a planning calculator for sample size.
- **Anti-circularity rule.** No generator may be tuned on the benchmark briefs after the first look at its scores; keep a held-out set of briefs. The 12 existing briefs are the development set; write 12 more for the held-out set.

**What exists.** `make_packet.py` builds the blinded HTML packet and the private key from any generator's results; `analyze.py` analyses returned ratings; `selftest.py` runs the analysis on *synthetic* ratings with a planted 70% preference: it recovered 72% with a 95% interval of 55% to 88%, and each planted dimension difference had the right sign. This tests the code, not Icarus.

**What it shows already.** With 12 briefs and 5 reviewers a true 70% preference still has a 33-point-wide interval. The planning calculator (with assumed variances that a pilot must replace) says detecting a 70/30 preference needs about 22 briefs with 8 reviewers or about 38 with 5, and cannot be done with 3 reviewers at any number of briefs because reviewer-to-reviewer variation does not shrink. So the benchmark needs either more briefs than we have, or a larger and more consistent reviewer panel.

**Checks on the tooling.** The blinded packet for the 6 briefs where both generators produced a plan is built by `make_packet.py` (`research/results/packet/packet.html`; the key is a separate `PRIVATE-key.json`). `packet_roundtrip.mjs` opens it in a simulated browser, fills the form, downloads the ratings and runs the analysis. A reviewer who always picks plan B came out at exactly 50/50 between generators, confirming the random side order cancels position bias. Those answers were invented; the packet has not been shown to any person. I could not view the page in the app's preview pane (local files render as static snapshots), so the layout has not been checked by eye.

## 8. Hardest remaining problems, after the spikes

1. **Quality metric.** Still undefined and still the root of everything else. The benchmark design is ready; the data is not.
2. **A polygon generator that scales.** CP-SAT worked on L-shapes at 8 to 14 rooms; the hard instances did not close their gap in 30 s. Corridors were an input, not an output. Generating the circulation skeleton from an arbitrary polygon (medial axis, with the spurious-edge problem the literature warns about) is the central unsolved piece.
3. **Weights.** Every multi-objective result depends on weights nobody has validated. The benchmark gives a way to fit them to architects' preferences.
4. **Calibrated uncertainty from sensors.** The schema can hold it; nothing produces it yet.
5. **Interior layout inside non-rectangular rooms.** Holodeck-style relation solving is the reference method; not spiked.
6. **IFC export that is useful, not merely valid.** Not spiked this round. The only specific hazard found: an opening that disappeared on a round trip in one user report.

## 9. Revised plan and estimates

The first assessment gave 4 to 6 months for M0 to M5 as a hypothesis. After the spikes:

| Item | Confidence now | Estimate | Why |
|---|---|---|---|
| Spatial model v2 and adapter (M0) | **High** | 2 to 3 weeks | The schema, validator and converter exist as a spike and pass on 12 real plans. The remaining work is hardening, migration of saved offices, and plumbing. |
| Geometry kernel on integer mm (M1) | **High** | 2 to 3 weeks | Library choice measured; arcs flattened for booleans. |
| Constraint registry with tiers (M2) | Medium | 2 to 3 weeks | Mostly refactoring `cost` and `diagnose`; the regression gate is the 12 briefs. |
| Edit ops over transactions (M4) | Medium | 3 to 5 weeks | Large, well-tested existing code and a 158-request regression set. |
| Polygon generator that beats the baseline in the benchmark (M3) | **Low** | 2 to 6 months, and it may not | Feasibility shown at 8 to 14 rooms with a given skeleton; quality unproven; scaling unproven. |
| Independent benchmark with real reviewers (M6) | Medium | 3 to 4 weeks to the first real result | Tooling exists; the constraint is recruiting five or more architects. |
| IFC/DXF/GLB export and scan import (M5) | Low | not estimated | Not spiked beyond a literature check. |

Do not read the first two lines as "the rewrite is cheap". They are cheap *because* the hard unknowns (generator, benchmark, scan) have been separated from the data model. The risky work is still ahead.

## 10. Recommended next steps

1. **M0 and M1 now.** They are the best-understood and they unblock everything: the adapter, the integer-mm kernel on Clipper2, and migration of saved offices. Gate: all 172 core tests and both evaluation sets pass through the adapter unchanged.
2. **Run the first real benchmark in parallel**, using the packet. Needs 5 or more reviewers, and a hand-drawn reference plan per brief.
3. **Second round of spikes** once the benchmark exists: corridor-skeleton generation from a polygon (the unsolved piece), CP-SAT scaling with hints and decomposition, an IFC round trip, and one real LiDAR scan.
4. **Not recommended yet:** learned generators (no licensable office data), a SceneScript dependency (research-only licence), any compliance feature.

## 11. Decisions that need the founder

- Confirm the first user. The pasted review recommended commercial interior designers and workplace-planning firms. That choice decides who the reviewers are and what an irregular plan looks like first.
- Can five or more practising designers be found for the benchmark, and will one draw reference plans for 12 or more briefs?
- Approve M0 (it changes the saved-office format; a migration plan comes with it).
- Is a LiDAR-capable iPhone or iPad available for the scan spike?

## 12. What this round did not do

- No expert human has looked at any plan produced here; every quality statement uses my own metrics.
- The CP-SAT comparison used 6 briefs, west entrance only, one fixed corridor skeleton, hand-chosen weights, and 30 s limits on one machine.
- MIP solvers, IFC writing, DXF, USD, WebXR, and LiDAR capture were not tested.
- Papers were read through excerpts, not end to end.
- The v2 schema is a draft; it has no versioning or migration story beyond a version string, no level-to-level geometry rules beyond connectors, and no furniture clearance checks.

## Where things are

| Path | What |
|---|---|
| `research/spikes/kernel/` | polygon library adapters and benchmark |
| `research/spikes/layout/` | CP-SAT, subdivision, independent metrics, circulation clearance |
| `research/spikes/export/` | exports the 12 briefs and baseline plans from the real engine |
| `research/spikes/schema/` | draft v2 schema, validator, adapter, examples, tests |
| `research/spikes/benchmark/` | blinded packet builder, analysis, synthetic self-test |
| `research/results/` | raw outputs and SVG plans |

To rerun: `cd research/spikes && npm install` for the Node spikes; a Python 3.12 environment with `ortools shapely numpy` for the layout spikes.
