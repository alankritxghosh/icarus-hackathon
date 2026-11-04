# Icarus

Design a whole office from scratch, in words.

Tell Icarus about an office. It plans the rooms and circulation, builds a walkable 3D model with furniture, lighting and materials, and accepts changes typed in plain words. You can also attach a photo to guide a new office's style. It is built for the Meta Global AI Developer Hackathon (Indie developer track).

Live: https://icarus.dream-studio.workers.dev

## Which Meta models it uses, and for what

| Model | Used for | Measured |
|---|---|---|
| **Muse Spark 1.3** (Meta Model API) | Proposing what the office needs beyond the brief (extra rooms, which rooms should share a wall or stay apart, area bias), revising a plan against the validators' findings, and reading free-form edit requests into edit operations. It never gives coordinates; the brief's stated facts are read by rules. Every answer is schema-checked; the layout engine and validators in `packages/core` decide what is accepted. | Edit requests: 20/20 usable answers, 16/16 doable requests read right, 4/4 impossible requests flagged, median 9.4 s (3 Nov, [run5](docs/reference/edit-model-eval/run5-muse-spark-3nov.json); same as 2 Nov run4). Design loop on 12 briefs: total cost 346.5 against 371.3 with no model, 6.7% lower, mixed per brief ([docs/META_CREDITS.md](docs/META_CREDITS.md)). |
| **Llama 3.3 70B** (Cloudflare Workers AI) | Answers instead when Muse Spark is refused, busy, down or past the $5 daily cap. The design trace names the model that answered. | Design loop: 361.8 on the same 12 briefs. |
| **Llama 4 Scout** (Cloudflare Workers AI) | Reading a reference photo into a style for a new office. | Live in the product. |

**Next on the roadmap:** Muse Voice Transcribe for spoken edits, SAM 3.1 for reading floor plans from images, and a Muse Spark critique of renders.

Output is **concept design only**. It is not a building-code check, a structural design or a construction document, and the homepage says so. See [docs/DESIGN.md](docs/DESIGN.md) for exactly what it does and how.

## Provenance

This repository was created on **26 October 2026, after the hackathon kickoff (12:00 PM EDT)**, and every line of code in it was written during the hackathon. The Git history is unedited, so `git log` shows exactly what was built and when.

The idea is not new to this repository: the author explored a similar product in an earlier private prototype before the hackathon. That prototype is **not part of this repository**, no code or tests were copied from it, and nothing in it used a Meta model. What carried over is the problem framing, the lessons learned and an early visual direction (since replaced by the current paper-and-navy design), not the code: every component here was written from scratch during the hackathon.

On 30 Oct 2026 two ideas from that prototype were added here: auditing a model against measured drawing evidence, and recording corrections as enforced lessons (`docs/QUALITY_SYSTEM.md`). They were rewritten from the design with different data structures and tests, and none of the prototype's source was opened or copied. The same AI coding assistant wrote both versions, so this is a reimplementation from the written design, not a blind clean-room.

Code in this repository was written with the help of AI coding assistants (Claude Code and Codex) under the author's direction.

## Status

What it does today (acceptance checklist: [docs/OPEN_GATES.md](docs/OPEN_GATES.md)):

- **Does:** designs a rectangular office from a typed brief, furnishes it, shows a floor plan, a 3D model and a third-person walk with a view in each workspace, reception, lounge, kitchen and meeting room, checks its own plan and repairs problems, and accepts edits typed in plain words (move, swap, resize, meeting rooms, phone booths, locks, undo), refusing what it cannot do. "Make it real" path-traces the light of the whole building with Blender Cycles on a Modal GPU (about 4 minutes on the 35-person studio), then you walk anywhere in first person under that light ([docs/REALISTIC_RENDERING.md](docs/REALISTIC_RENDERING.md)); furniture keeps live lighting. It saves office and drawing projects in this browser, exports GLB for Blender, and exports a DXF plan when asked in chat. In a local run with the drawing worker, a vector PDF can be read into a 3D building (this is switched off on the live site), and a straight partition between two named, enclosed rooms in a newly imported plan can be moved by a stated distance and undone.
- **Tested by designers:** more than five interior designers have tried Icarus on their own briefs and edits.
- **Coming next:** L-shaped and multi-floor offices in the app, broader editing of imported drawings, voice input, and projects that follow you across devices.

Plan and daily log: [docs/HACKATHON.md](docs/HACKATHON.md). QA approach and current gaps: [docs/QA.md](docs/QA.md). Architecture and what was measured: [docs/ARCHITECTURE_ASSESSMENT.md](docs/ARCHITECTURE_ASSESSMENT.md), [docs/RESEARCH_ROUND_2.md](docs/RESEARCH_ROUND_2.md), [docs/SPATIAL_MODEL.md](docs/SPATIAL_MODEL.md).

## Run it

```
pnpm install
pnpm --filter @icarus/web dev      # the app; works without any key, using built-in rules
pnpm --filter @icarus/edge dev     # optional: the Worker for model and drawing services
pnpm verify                        # types, lint, tests
```

Model keys go in a local, uncommitted `.env` (see `.env.example`); nothing in this repository contains a secret.

## Licences

Code: MIT. Furniture models: CC0 from Poly Haven ([assets/LICENSES.md](assets/LICENSES.md)).
