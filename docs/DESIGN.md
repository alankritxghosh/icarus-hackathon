# Icarus: design a whole office from scratch

One goal. Icarus takes a description of a company and a building shell, and produces a complete, walkable 3D office that you can then change by talking to it. Everything else is out of scope until this works.

## The demo test (what "done" means)

Given: "A 35-person design studio. Open studio, three meeting rooms, two phone booths, a kitchen and lounge, reception, storage and server closet, restrooms. 24 m by 16 m shell, windows on the south and east walls, entrance on the west."

Icarus must:

1. Produce a **floor plan** with every requested room, sized sensibly, with walls, doors, windows and a connected circulation network. No overlaps, nothing unreachable.
2. Build the **3D office**: real wall thickness, door and window openings, floor, ceiling, furniture in every room (desks by headcount, meeting tables and chairs, kitchen units, sofas, reception desk, restroom fixtures), lighting, materials.
3. Let me **walk through it** and look at it from above.
4. Let me **change it in words or voice**: "move the kitchen to the east side", "make meeting room 2 bigger", "add a third phone booth", "swap the reception and the lounge". It re-plans only what must change, keeps what I locked, and says what it did.
5. Show an **evidence panel**: area per person, program areas against targets, corridor widths, adjacency wishes met or missed, rooms with and without daylight, every assumption stated.
6. **Export**: GLB for the 3D model, and a plan drawing.

This is concept design. It is not a building-code check, a structural design or a construction document, and the evidence panel says so.

## How the pieces fit

- **Program** (Muse Spark, structured output): words, and later a photo of an existing plan, become a typed program: rooms, counts, target areas, adjacencies, daylight and privacy needs, with every assumption listed and a confidence on each.
- **Layout** (deterministic, `packages/core`): a seeded search places rooms inside the shell and inserts circulation, scoring every candidate. The model never draws geometry; it proposes the program and priorities and critiques results. The solver decides what is valid.
- **Build** (deterministic): the plan becomes walls with real openings, floors, ceilings, furniture kits per room kind, lighting and materials, as one scene graph with stable ids.
- **Critique** (Muse Spark vision): the app renders a top-down and a perspective view; the model looks at them and proposes fixes as typed edit commands, which the solver validates before anything changes.
- **Edit** (Muse Spark tool calls, Muse Voice Transcribe): speech or text becomes typed commands (move, resize, add, remove, swap, lock, restyle). Commands are validated and applied locally.
- **View** (web app, three.js): 3D orbit and walk views, plan view, chat and voice, evidence panel, export.

## The layout approach

Rectangular shells first, then L-shapes if time allows. The shell is split into zones along a circulation spine; rooms are packed into zones by area-proportional guillotine cuts; a seeded random-restart search tries many orderings and picks the best by a cost made of area error, aspect ratio, adjacency, daylight, entrance sequence and corridor connectivity. The same cost produces the evidence panel, so what the user sees is exactly what the search optimised, not a separate story.

Edits re-run the search with the unchanged rooms pinned, so a change moves only what it must.

## Honesty rules

- Concept design only. No compliance, structural or fire-safety claims anywhere.
- Every inferred number carries its source and confidence. The user can always see what was assumed.
- Evidence reports measured facts about the generated plan (areas, widths, reachability), never "quality scores" without a defined meaning.
- A model proposal is never applied without passing the solver's validation.

## Non-goals

CAD and STEP, structural analysis, MEP, multi-storey buildings, non-rectilinear walls, cost estimates, real furniture catalogues.

## Product principle: prompt in, finished office out

The model is Lovable for 3D: the user describes the office and Icarus makes every decision (rooms,
furniture, materials, lighting, camera) and hands back a finished, photographic result. The user
should never need to adjust anything to get a good first result. Editing exists (change by words,
then the Edit panel) but is the exception. Anything that needs a manual fix to look right is a bug
in the pipeline, not a feature of the interface.

## Realism, in two tiers

1. The live scene is ours: PBR materials, image-based lighting, shadows, real CC0 furniture models.
   It stays exactly faithful to the plan and responds instantly.
2. "Make it real" repaints a snapshot of the live scene with an image model, using the snapshot as a
   reference so the layout is kept. Pictures are labelled illustrative unless checked against the plan.

First target style: warm oak and green. All tuning is against that one look.

## Providers

OpenRouter now, Meta later, through one adapter. OpenRouter serves Meta's models (`meta/muse-spark-1.3`,
`meta/muse-spark-open`, `meta/muse-glimmer-30b`, Llama 4) behind one key, so switching is a model slug,
not a rewrite. Development uses a free model; the submission must run `ICARUS_MODEL=meta/muse-spark-1.3`
and say so. Known limits through OpenRouter: no conversation state (the tool loop resends history), no
SAM 3.1 endpoint, and `meta/muse-image` is listed with no endpoints yet, so the default picture model is
the open-weight `black-forest-labs/flux.2-klein-4b`.

## Assets

CC0 only, from Poly Haven (hand-made, no generative AI), recorded in `assets/LICENSES.md` with source
URLs. Poly Haven asks that its use is visible to users, so the product credits it. Nothing generated by
a model is passed off as a modelled asset.
