# Hackathon plan and log

Track: **Indie developer**. Theme: **Push the Frontier**. Kickoff Mon 26 Oct 2026 12:00 PM EDT. Submission due **Wed 4 Nov 2026, 9:00 PM EDT**. Demo-ready target: Mon 2 Nov.

## The product

Design a whole office from scratch, in words. See [DESIGN.md](DESIGN.md) for the demo test, the pipeline and the honesty rules.

## Schedule

- 26 Oct: fresh repo, Meta adapter with fake and contract tests, decision to focus on one thing (the whole-office design).
- 27 Oct: program schema, room catalog, layout engine v1 with scoring.
- 28 Oct: walls with real openings, floors, ceilings; first plan to 3D in the browser.
- 29 Oct: furniture kits per room kind, lighting, materials; walkthrough camera.
- 30 Oct: Muse Spark program extraction and typed edit commands with the tool loop; undo.
- 31 Oct: evidence panel; render critique loop; plan drawing and GLB export.
- 1 Nov: voice edits, polish, three sample offices, live API verification.
- 2 Nov: freeze, three-minute video, README. 3 to 4 Nov: buffer and submit.

## Daily log

### 26 Oct (kickoff day)

- Created this repository after kickoff. Workspace, license, provenance statement, project rules.
- Wrote the Meta Model API adapter (`packages/meta`) from the public docs: bearer-authenticated transport with timeouts and retries (rate limits honour Retry-After), Responses API wrapper with schema-constrained output validated again on our side, a bounded tool-calling loop that validates arguments before anything runs, vision grounding (points and boxes on the 0 to 1000 grid), SAM 3.1 segmentation parsing, and a deterministic fake that applies the same validation as the real client.
- 18 contract tests pass against the documented request and response shapes. Two live smoke tests exist and are skipped until `MODEL_API_KEY` is set, so **nothing here has yet been confirmed against the real API**.
- Narrowed the whole project to one goal: design an entire office space from scratch. The CAD and STEP direction from the earlier prototype is dropped.
- Built the core of the office designer (`packages/core`): the office program schema (headcount, shell, rooms, assumptions, with catalog rules of thumb that are labelled as assumptions), a canonical-frame transform so any entrance side reduces to one case, and a layout engine that tiles the shell exactly with rows of rooms, corridors and an entrance lobby, searched with seeded simulated annealing against a cost made of room size, aspect, depth, daylight, adjacency and entrance sequence.
- Added an evidence module that measures the plan (areas, workspace per person, daylight exposure, adjacency wishes, reachability from the front door) from the same quantities the search optimises, and states that this is concept design, not a code check.
- 42 core tests: invariants hold across seeds and all four entrance sides (every room once, exact tiling, doors on their walls and onto real circulation, reachable from the entrance, reproducible from a seed, better than the best of 300 random orderings).
- Known weak spot, reported honestly: small rooms in a deep row are forced to their minimum width, so the demo lounge comes out about 1.8 times its target size. A stacked-room layout would fix it and is on the list.
- Decided: rectangular shells only for the hackathon, for reliability.
- Built the shell of the 3D office (`packages/core/src/build`): a scene model of boxes and cylinders in metres, walls generated from room edges and merged so a shared wall is built once, exterior walls placed outside the clear shell, door and window openings cut cleanly with leaves, glazing and frames, floors with a finish per room kind, and a ceiling.
- 12 build tests check the geometry itself: every room boundary is closed by wall, door leaf or glass at eye height, every opening is clear of wall, shared walls are single, for all four entrance sides, with and without windows, and for different ceiling heights. The first run found a 3 cm gap beside each door leaf and a wrong test sample on glazed walls; both fixed.

