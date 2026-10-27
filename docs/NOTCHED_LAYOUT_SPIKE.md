# L-shaped floors from the row engine: prototype result

27 to 28 October 2026. A prototype, not product code: nothing in `packages/` or `apps/` changed. Code: `research/spikes/notched/notched.test.ts` (layout) and `research/spikes/layout/score_notched.py` (scoring). Raw numbers: `research/results/notched-summary.json`, plans as SVG in `research/results/svg/*_L_rowzones.svg`.

## The question

The layout engine only knows rectangular floors. Before paying for L-shape support across the whole pipeline, does the cheapest possible method produce good L-shaped plans?

## The method

Keep the existing row engine and cost function. Split the L into two stacked zones that share one full-height entrance lobby on the west wall: a top zone beside the missing corner (narrower) and a bottom zone (full width). Rows of rooms stack through both zones. One corridor runs along the foot of the missing corner and serves the last top row and the first bottom row, so every room still opens onto a corridor that reaches the lobby. The zone split is a function of the rows and their target areas only, so a plan can be recomputed from its rows, as the edit engine requires. The existing annealing over room order is reused with the notched layout as the thing it realizes.

Test set: the seven briefs with a west entrance, each in an L with the same floor area as its rectangle (a 35% by 40% corner removed in the north-east), scored by the same independent metrics as the CP-SAT and subdivision spikes.

## Results

Six briefs that CP-SAT solved, same metrics, same L (`notched-summary.json`):

| Generator | Mean area deviation | Undersized rooms/plan | Min-side violations/plan | Adjacency wishes met | Rooms lit | Unreachable rooms/plan | Time per plan |
|---|---|---|---|---|---|---|---|
| Row zones (this prototype) | 0.33 | 1.5 | 1.5 | 79% | 58% | **0** | 0.1 to 0.35 s |
| CP-SAT | **0.09** | 2.3 | **0.8** | **96%** | **68%** | **0** | 0.4 to 30 s |
| Subdivision | 0.34 | 2.8 | 3.2 | 60% | 53% | 0.17 | 10 s search |

All seven briefs gave a valid plan: no overlap, nothing outside the floor, every room has a clear route from the front door. That includes the tight 8-person brief that CP-SAT reported infeasible; like today's rectangular engine it fits it by shrinking rooms (6 undersized, 4 below minimum side), and says so in the metrics.

## What this shows and does not show

- **The method is viable.** It is fast, deterministic from its rows, never leaves a room unreachable, and always returns a plan. It reuses the code the product already trusts.
- **It is not as good as CP-SAT on adjacency and daylight, and not clearly as good as today's rectangular engine.** For reference the rectangular baseline on these briefs scored 96% adjacency and 74% rooms lit. Part of the daylight gap is a prototype limit: rooms along the new walls at the missing corner get no daylight credit, because windows are defined on the four sides of the bounding box. Part is the lighter search (four thousand steps, eight restarts).
- **Limits of the test:** six or seven briefs, one notch shape and corner, a west entrance only, my metrics, no architect has looked at a plan. The notch corner must be on the far side from the entrance; a notch beside the entrance is not handled.

## What making it real would take

Judgment, not measured. The rectangle shell is assumed in about 25 files and 85 places (layout, walls, scene, evidence, diagnosis, repair suggestions, the edit engine, the viewer, the plan thumbnail). A real implementation needs: a `notch` on the shell (additive, so the rectangular path is unchanged and the gate still applies); the zone layout in `layout/`; notch walls and floor and ceiling in `build/`; area and daylight evidence that knows the notch; an L outline in the spatial adapter and `toFloorPlan`; the edit engine either handling zones or refusing with a reason (it already refuses models it cannot read); and drawing the L in the viewer and thumbnail. I would estimate one to two weeks of focused work, with the rectangular gate as the regression check at every step. The user-facing piece is a shape picker, to be added only once the plans are good enough to show.

## Recommendation

Worth building, in this order: (1) give notch walls windows in the daylight measure and re-run this comparison, to find out how much of the gap is the prototype; (2) integrate behind the existing gate. Keep CP-SAT as the research benchmark for what "good" can look like, not as the product engine: it is slower, needs a Python worker, and was not deterministic when time-limited.
