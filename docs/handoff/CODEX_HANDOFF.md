# Handoff to Codex: Icarus, as of 30 Oct 2026 (night)

Written by Claude (Sonnet 5.5) at the founder's request. Read this first, then `CLAUDE.md`, `docs/HACKATHON.md` (the daily log) and `docs/ENGINEERING_RULES.md`.

## The principle to follow: simplicity in technology

**We choose simplicity in technology. Nothing unnecessary is used anywhere.** No library, service, setting, abstraction, panel, button or line of copy the product does not need today. Before adding anything, ask whether the product works without it, and prefer what is already here. When something stops being needed, delete it in the same change. It applies to code, infrastructure, the interface, and what the customer is told: the customer sees a conversation and a model, never mechanics (no counters, no technical captions). It is written into `CLAUDE.md`. Judge every change against it, including your own.

## Goal and vision

Icarus is spatial intelligence for buildings: a person says (or attaches) what they want and gets a finished, realistic, editable 3D building back, with no tuning. The shape is Lovable's: a conversation on the left, the live model on the right. Everything the person needs is done by prompting; to edit beyond that they export to Blender (GLB). Today it designs offices from words, reads floor-plan PDFs into 3D, and renders the model realistically on the viewer's own GPU. The longer aim (founder, 27 Oct): the best possible Icarus, not a hackathon-shaped one: generate, reason about, optimise, edit and reconstruct buildings over one spatial model, with deterministic geometry and honest evidence, so a design partner can trust it.

Non-negotiables (from the founder, in `CLAUDE.md`): a model may only *propose*, deterministic code and validators *decide*; engineering output stays concept-stage and never claims code compliance, structural soundness or readiness; report measured numbers with their limits; every correction a person gives becomes an enforced lesson.

## State of the work

Two repositories. **This one (`/Users/alankritghosh/icarus-hackathon`) is the product.** `/Users/alankritghosh/Icarus-Follow That Dream` is the frozen private prototype: ideas were reimplemented here from the design, **no code was copied** (README provenance statement says so and says the same AI wrote both). Do not copy code from it. Its third- and fourth-floor benchmark work and the old audit live there.

Local only: 50 commits here, **14 ahead of `origin/main`, nothing pushed.** `pnpm verify` passes (core 179, spatial 110, web 45, edge 38, meta 38 tests). Last deploy `icarus-edge` on 30 Oct.

### What the product does now

- **One screen** (`apps/web/src/Studio.tsx`, `App.tsx`): chat left, 3D right, a "Make it real" button, a 3D/Plan/Walk switch, Export for Blender. Typed commands: "make it real", "walk in", "top view", "go outside", "hide the ceiling", "export", "start over". A PDF or photo is attached in the message box.
- **Design from words** (`designLoop.ts`, `packages/core`): a model (Workers AI Llama) proposes what a brief leaves open; the rule-based layout engine and validators decide; a repair loop improves the plan; furniture is placed by room-kind kits. Edits by words use a closed set of operations (`packages/core/src/edit`).
- **Learn from typing** (`taught.ts`, `packages/spatial/src/accountLessons.ts`): any sentence stating a preference ("never put plants in the kitchen") is stored as a validated rule in the browser and applied to the scene. Closed grammar, four rule kinds, mandatory built-ins cannot be switched off.
- **Drawings** (`packages/spatial`): `pdfEvidence.ts` reads a vector PDF's shapes and text (poppler views) into evidence; `sheetScale.ts` reads the scale from the sheet's dimension strings; `fromDrawing.ts` builds a spatial model (walls, openings, enclosed rooms, outline closed where the sheet draws none, all marked measured/inferred); `sceneFromModel.ts` draws it and furnishes enclosed rooms by name (living, study, dining, store with CC0 models; bedroom, toilet, shower, kitchen, gym, wardrobe with box-built pieces and the same models). The chat says what was read, closed, furnished and left out.
- **Make it real** (`officeView.ts`, `docs/REALISTIC_RENDERING.md`): progressive GPU path tracing in the browser (`three-gpu-pathtracer`), lit by a photographed sky, photographic PBR floors and walls, grass ground with outdoor plants. Nothing is shown about progress.
- **Assets** (`assets/manifest.json`, `scripts/fetch-assets.mjs`, `assets/LICENSES.md`): 25 CC0 models, 11 PBR texture sets and one sky from Poly Haven, fetched with size and MD5 verified. 74 MB. New downloads need the founder's approval with names and sizes first.
- **Quality libraries not shown in the UI** (by the founder's decision): `drawingAudit.ts` (audit a model against a drawing), `lessons.ts` (built-in enforced lessons), `principles.ts` (a router over the 20 design principles using only thresholds from `packages/core/src/knowledge/office.v1.json`). See `docs/QUALITY_SYSTEM.md`.

### Infrastructure (all under the founder's accounts)

- **`icarus-edge`** Cloudflare Worker on `https://icarus-edge.ayushghosh2015.workers.dev` (unlisted). Serves the built web app (assets binding) and `/api/*` (design, photo reading, drawing views). Two rate-limit bindings on the drawing route (6/min per caller, 60/min overall; approximate by design). Secrets `DRAWING_WORKER_URL`, `DRAWING_WORKER_TOKEN`. Deploy: `pnpm --filter @icarus/web build && cd apps/edge && npx wrangler deploy` (needs `wrangler login` on this Mac).
- **Modal `icarus-drawing`**: poppler on CPU, returns a PDF page's SVG and word boxes; bearer-token protected. Deploy: `cd workers/drawing && ../reconstruct/.venv/bin/modal deploy app.py`. Secret `icarus-drawing`.
- `apps/edge/.dev.vars` (git-ignored) holds the worker URL and token for local runs. No secret is in the repository.
- Local dev: `pnpm --filter @icarus/web dev` answers `/api/drawing/views` with local poppler (`brew install poppler`) and proxies the rest to `ICARUS_EDGE` (set it to the live edge URL).

## Why it was built this way

- **Models propose, code decides.** Free-tier language models are unreliable; validators and a deterministic layout engine make a wrong guess unable to produce an invalid building. Measured: the propose-and-repair loop cut open issues about 43% on twelve briefs (`docs/DESIGN_LOOP.md`).
- **One spatial model** (`docs/SPATIAL_MODEL.md`): integer millimetres, provenance on every fact (stated / measured / estimated / inferred / generated), so a building read from a drawing can say what it knows. Drawings, offices, DXF and the scene are projections of it.
- **Read drawings from their vectors, not pixels.** A free vision model read a real plan as a bare box; the vector shapes gave walls to within a few millimetres. Parsing happens in the browser; the Worker and Modal only run poppler, so the rules live in one place.
- **Scale from the sheet** because asking people is friction. A first approach (flooding rooms to match printed sizes) failed on the real sheet and was dropped for dimension strings and the lines under them (8 of 33 agreed on the real A3 sheet; about 1:80).
- **Path tracing in the browser, not stills.** The old "Make it real" produced a static image that invented details and cost a GPU call each click. Alternatives and the one machine measured are in `docs/REALISTIC_RENDERING.md`.
- **Photographic materials and a photographed sky** because flat colour was the main reason it looked unlike a real office; the same pieces light the realistic render and make the quick view better.
- **Learning is typing**, not a settings panel: the founder's rule is that every correction teaches the product.
- **No panels, buttons or counters** the customer does not need: the founder's rule that prompting is the interface.
- **Provenance is protected**: this repo's whole claim to the hackathon is that it was written during the event.

## What is pending, and why

1. **Push and go public (needs the founder).** Stealth until 2 Nov 2026; submission due 4 Nov 9 PM EDT and needs a public repo. Before publishing: re-read the README provenance statement, check the Meta-use statement, check nothing private is committed. The prototype repo's "frozen" claim is also blurred (it gained ~34 commits after its `pre-hackathon` tag); fix the wording or disclose.
2. **Meta models are not integrated beyond Llama on Workers AI.** Stage-1 judging is pass/fail on use of Meta AI products. Muse Spark, SAM 3.1 and voice transcription are untested or unbuilt (see `docs/META_CREDITS.md`). Blocked on credits and a key. This is the largest risk to the submission.
3. **Voice edits** are not built (needs Muse Voice Transcribe).
4. **Drawings:** on the real sheet only 5 of 23 labelled rooms close, because its outer walls are outlines; the outline closure is inferred (and said). A drawn building can be viewed, walked and exported but not edited by prompt: the edit engine is office-only. Scale reading needs dimension strings or a printed scale. Reading stroked outlines as walls would close more rooms.
5. **Furniture in drawn plans** is by room name only and uses simple box-built pieces for beds, toilets, kitchens and gyms. Better models need the founder's approval of names and sizes. There is no office swivel chair on Poly Haven; desk chairs are a lounge chair at 70%. Phone booth, reception desk, fridge, island, server rack and cubicles are still boxes.
6. **Realistic render** was measured only on one Apple M1 in the desktop app's embedded browser (orbit about 10 samples a second, walk about 4, with the lighter models); nothing else was tried and nothing was compared with a photograph. The denoise is a simple edge-aware blur.
7. **Accounts:** lessons live in the browser. A signed-in account (and cross-device lessons) needs identity and storage that this repo does not have.
8. **Principle router thresholds:** only the repo's planning defaults are used. Daylight area, ventilation, acoustics and others need a named jurisdiction and a qualified reviewer; none are invented.
9. **Edge exposure:** the Worker is public and unauthenticated; the rate limit is approximate. The founder's other routes use the free Workers AI allowance.
10. **No browser end-to-end tests.** The UI was verified by hand in the embedded browser; unit tests cover the logic. One real bug (an effect attached to the wrong hook) was only found that way.

## Simplicity audit: for you to finish

Needed today: React and Vite (the app); `three` (viewer); `three-gpu-pathtracer` and `three-mesh-bvh` (Make it real); `zod` (every external boundary is validated); `clipper2-wasm` (polygon geometry in the spatial kernel); Cloudflare Worker (serve and protect); Modal and poppler (read a PDF).

**Candidates to remove or justify, not yet checked against the founder's plans:**
- `packages/core/src/reconstruct`, `workers/reconstruct`, `docs/RECONSTRUCTION.md`: the photo-to-geometry work is not used by the current app.
- `packages/spatial/src/dxf.ts`: no UI uses it now (Blender export is GLB).
- `drawingAudit.ts`, `lessons.ts`, `principles.ts`: not surfaced by decision. Keep only if you wire them to a real need; otherwise delete with their tests.
- `describeStyle` in `packages/core/src/style.ts` and the style palette: check whether anything reads them.
- Textures installed but unused: red brick, clay roof tile, denim. Either use them or drop them from the manifest.
- Two repositories and a long `docs/` folder: consolidate what a new reader needs.

When you delete, run `pnpm verify`, update `docs/HACKATHON.md`, and keep the commit small.

## How to work here

- Read `CLAUDE.md` and `docs/ENGINEERING_RULES.md` (explainable, evidence-backed, independently tested). A check that reuses the code's own score is not a test.
- Commit small, verified checkpoints. **Never push, make public, deploy or create paid resources without the founder's explicit approval.** Never print or commit secrets. Do not rewrite history or set commit dates.
- Run `pnpm verify` before every commit. For visual work, look at it in a browser; for the realistic render, drive it and say what you measured and on what.
- Report honestly: what was checked, what was not, what failed.
