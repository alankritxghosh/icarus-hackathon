# Engineering rules

Adopted 28 October 2026 at the founder's direction. They apply to every person and every AI agent working on Icarus.

## The three rules

1. **Nothing enters the architecture that the founder cannot have explained.** Not every line, but for each component: what it does, why it exists, what it assumes, and what can go wrong. Each component below has those four answers in plain words. A component without them is not accepted.
2. **Every major engineering decision requires evidence.** A recommendation (OR-Tools, Clipper2, a reconstruction model, a geometry representation) comes with the alternatives considered, the trade-offs, and an experiment that shows why the choice is appropriate. No technology is adopted because an AI agent says it is good.
3. **Every major subsystem needs an independent test.** "The demo looks right" does not count. Geometry is tested against known cases. Layouts are tested against external architectural evaluation. Reconstruction is tested against measurable reference geometry. Editing is tested for unintended changes.

## What "independent" means here

A test is independent when it would still catch the mistake even if the code under test and its author were wrong in the same way. So: a second implementation written separately counts for something but not for everything (same author); a standard tool reading our output (an unrelated CAD library, a validator) counts; a known answer worked out by hand counts; a human expert's rating counts most. A check that reuses the code's own score does not count: the optimiser and the judge share the same hand-weighted rules.

## Decision record (use for every major choice)

Keep one short record per decision, in `docs/decisions/` once the first one is written:

- **Decision** and date.
- **Alternatives considered** (at least two real ones).
- **Experiment** (what was run, on what, with what result, where the numbers are).
- **Why this one**, and what would make us change our minds.
- **Known limits** of the experiment.

## Audit of the current work (28 October 2026)

Honest status of each component against the three rules. "Evidence" is for rule 2, "Independent test" is for rule 3. The right-hand column is the gap and the cheapest way to close it. Gaps are ranked at the bottom.

| Component | In plain words (what, why, assumes, goes wrong) | Evidence for the choice | Independent test today | Gap and fix |
|---|---|---|---|---|
| **Brief reader** (`readBrief`) | Turns a typed description into a structured brief with rules, no model. Exists so it works without a key. Assumes common phrasing; records every assumption. Can misread a number or a room. | None against alternatives (for example a model reader). | Hand-written cases only. | Score it on a set of real briefs written by someone else (the designer friend). |
| **Language model helper** (Llama via Workers AI or OpenRouter; Muse Spark from November) | Fills in what a brief left open, only through fixed answer shapes. Exists because people under-specify. Assumes the model's answer is checked, never trusted. Can invent rooms or ignore the format. | Strong: ten free models tried; the 12-brief evaluation showed the model adds little (362 against 371 without it). | Every answer is schema-checked and measured against the rules-only plan. | Muse Spark untested (credits). Run the same evaluation once available. |
| **Knowledge file** (`office.v1.json`) | The room sizes, adjacency and widths the engine uses. Exists so rules are data, not code. Assumes rules of thumb; most are labelled "icarus-default". Can be wrong for a real client. | Two values cite the ADA standard as a floor; the rest are our defaults. | None. | **High.** Needs an architect to confirm or correct the numbers. |
| **Layout engine** (rows and corridors, annealed) | Places rooms in rows with corridors and a lobby. Exists because it is fast, deterministic and explainable. Assumes a rectangular floor. Can fail on odd shapes or tight programs (it shrinks rooms and says so). | Partial: compared with CP-SAT and a subdivision method on 6 to 7 briefs, same metrics (`RESEARCH_ROUND_2.md`). The original choice of rows was not tested against alternatives before it was built. | Self-scored by our own cost, plus a second implementation of the metrics by the same author. | **High.** No external architectural evaluation. Packet and analysis are ready; needs five or more reviewers. |
| **Diagnose and score** (`diagnose`, `issueCost`) | Measures a plan (small rooms, seats, adjacency, daylight) and turns it into one number. Exists so changes can be compared. Assumes our weights are sensible. Can reward what we measure, not what people want. | Weights are hand-chosen. | The optimiser and the judge share these rules (circular). | **High.** Same as above: ratings from architects to fit or replace the weights. |
| **Repair loop** | Tries small fixes and keeps one only if the measured score improves. Exists to fix problems automatically. Assumes the score is right. Can polish toward our own metric. | Measured: 655 down to 371 on 12 briefs. | Mutation-checked tests (breaking the safeguard fails a test). The 43% is on our own metric. | Do not claim quality from the 43%; see above. |
| **Edit by words** | Reads a request into a few fixed operations and applies one only if measured to be safe; says no, with a reason, otherwise. Exists so a request cannot produce a broken office. Assumes the operations cover what people want. Can misread a sentence or refuse a good change. | The grammar and operations were built first; no alternative design was compared. | Strong: 158 requests, 72 chains, model path equals direct path, mutation checks. **Not covered:** that an edit leaves unrelated rooms alone and that the reported movements are true. | **Medium.** Add an unintended-change test (below). |
| **Furnishing** | Places desks, chairs and fixtures from per-room kits. Exists because rooms must look usable. Assumes standard sizes and clearances. Can crowd or miss a seat (a one-millimetre knife-edge was found and fixed). | None against alternatives. | Tests for no overlaps and door clearance; own code only. | **Medium.** Check against a published ergonomics reference. |
| **Spatial model** (`packages/spatial`) | One description of a building: rooms, walls, doors, windows, columns, curves, floors and how sure we are of each fact. Exists because rectangles cannot hold a real building. Assumes IFC-like names suit us. Can hold things the editor cannot yet move. | Weak: converts 12 real plans and validates, but no alternative representation (IFC-first, GeoJSON-like) was compared. | Our own validator and tests only. | **High.** Round-trip through IFC with an independent reader (`IfcOpenShell`). Also the cheapest way to compare alternatives. |
| **Geometry kernel** (Clipper2) | Adds, subtracts and offsets room shapes in whole millimetres. Exists so two walls that agree are the same wall. Assumes a third-party WebAssembly port stays maintained. Can fail if that port is abandoned. | Strong: benchmarked against two alternatives on exactness, degenerate input, noise and speed (`RESEARCH_ROUND_2.md`). | Known answers, random cross-checks, identities; the research run also cross-checked against a second library. | Low. Optionally keep a second library as a test-only cross-check in the product tests. |
| **Door-graph reachability** (in the app) | Checks every room is reachable from the front door by doors and openings. Exists to catch sealed rooms. Assumes doors are the only connections. Can say "reachable" for a corridor too narrow to use. | Measured: four hand-made plans where it said yes and a clear-width test said no. | Hand-made cases. | **Medium.** The clear-width check exists only in research; bring it into the app. |
| **Clear-width check** (research) | Walks the floor with a 0.9 m clearance. Exists because topology is not usability. Assumes a grid is good enough. Can under-read by 0.1 to 0.2 m. | Measured on four cases. | Uses a standard library (Shapely) for geometry; our own walker. | Replace the grid with exact offsetting before relying on it. |
| **CAD drawing export** (DXF) | A plan drawing for CAD programs. Exists because designers work in CAD. Assumes the old, universal format is enough. Can drop curved-wall doors. | Format chosen for compatibility; alternatives not compared. | **Good:** read by an unrelated CAD library (`ezdxf`) with zero audit errors and matching counts. | Also open it in a real CAD program. |
| **3D export** (GLB) | The 3D view as a file. Exists so a designer can take it elsewhere. Assumes the viewer's scene is the truth. Can be large (14 MB). | None against alternatives. | Weak: header and index consistency only. | **Medium.** Run the Khronos glTF validator and open it in Blender. |
| **Picture repaint** ("Make it real") | An image model repaints a view to look like a photograph. Exists because customers judge by looks. Assumes the model keeps the layout. Can invent details and drift from the plan. | Free image models tried; no comparison of fidelity. | None for fidelity; rated by the engineer, not by people. | **High** for sales. Test against the geometry (edges or depth) and have designers rate it. |
| **Reconstruction from photos** (paused) | Estimates a room's size from one photo. Exists for the long-term vision. Assumes the scale can be calibrated. Can be 10 to 25% off. | Depth Pro rejected on licence; MoGe-2 chosen on licence and tests; compared to nothing else. | Better than most: scored against our own offices where truth is known (median error 5.5%). | Paused; needs a real LiDAR reference before any claim. |
| **Spending limit** (Meta credits) | Stops a paid model route at a daily cap. Exists because credits are money. Assumes the provider reports honest token counts and the prices are entered correctly. Can overshoot by one call. | Design is standard. | Tests and a mutation check; no live check until credits exist. | Verify against Meta's own usage figures on day one. |
| **L-shape layout prototype** | Lays out an L-shaped floor in two zones. Exists to test the idea cheaply. Assumes the notch is far from the entrance. Can place rooms with weaker adjacency. | Compared with two alternatives on 7 briefs. | Same metrics as above. | Not product code; see its write-up. |

## Gaps ranked, with the experiment that closes each

1. **Layout quality has no external evaluation** (rules 2 and 3). Run the blinded architect review that is already built: at least five reviewers, a human-drawn reference plan for each brief. This also fits the knowledge file and the score weights.
2. **The knowledge file is unvalidated** (rule 2). Have a designer mark each number agree, too small, too large. Half a day of their time.
3. **The picture repaint is untested for fidelity** (rule 3). Compare edges or depth of the repaint with the 3D scene for the same view; then rate with designers.
4. **The spatial model was never compared with alternatives** (rule 2). Export to IFC, read it back with an independent reader, and compare areas and counts. One to two days.
5. **Editing is not tested for unintended changes** (rule 3). Add: after every applied edit, any room that moved or changed size beyond a tolerance must be named in the report, and no room the report calls unchanged may have moved. Half a day, uses the existing 158 requests.
6. **The GLB is not independently validated** (rule 3). Run the Khronos glTF validator and open it in a second program. Half a day.
7. **Door-graph reachability misses narrow corridors in the app** (rule 3). Bring the clear-width check into the product with exact offsetting.

## How the rules change what we do

- A new dependency, algorithm or representation needs a decision record before it merges.
- A new subsystem needs an independent test before it is called done in a status line, the README or a demo.
- Status lines say "measured against X" and name X. They never say "works" for something checked only against itself.
