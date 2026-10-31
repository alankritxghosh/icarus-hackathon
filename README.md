# Icarus

Design a whole office from scratch, in words.

Tell Icarus about an office. It plans the rooms and circulation, builds a walkable 3D model with furniture, lighting and materials, and accepts typed changes. You can also attach a vector floor-plan PDF to view it in 3D, or a photo to guide a new office's style. It is built for the Meta Global AI Developer Hackathon (Indie developer track). Today the language model calls use Meta's Llama models (Llama 3.3 70B and Llama 4 Scout, through Cloudflare Workers AI); Muse Spark, SAM 3.1 and Muse Voice Transcribe are planned and **have not been tested or built yet**.

Output is **concept design only**. It is not a building-code check, a structural design or a construction document, and Icarus says so wherever it matters. See [docs/DESIGN.md](docs/DESIGN.md) for exactly what it does and how.

## Provenance

This repository was created on **26 October 2026, after the hackathon kickoff (12:00 PM EDT)**, and every line of code in it was written during the hackathon. The Git history is unedited, so `git log` shows exactly what was built and when.

The idea is not new to this repository: the author explored a similar product in an earlier private prototype before the hackathon. That prototype is **not part of this repository**, no code or tests were copied from it, and nothing in it used a Meta model. What carried over is the problem framing, the lessons learned and the approved visual design (dark graphite and green, sidebar, one prompt, Home to Building to Built flow), not the code: every component here was written from scratch during the hackathon.

On 30 Oct 2026 two ideas from that prototype were added here: auditing a model against measured drawing evidence, and recording corrections as enforced lessons (`docs/QUALITY_SYSTEM.md`). They were rewritten from the design with different data structures and tests, and none of the prototype's source was opened or copied. The same AI coding assistant wrote both versions, so this is a reimplementation from the written design, not a blind clean-room.

Code in this repository was written with the help of an AI coding assistant (Claude Code) under the author's direction.

## Status

Working build, not a finished product. What it does today and what it does not:

Current acceptance checklist: [docs/OPEN_GATES.md](docs/OPEN_GATES.md).

- **Does:** designs a rectangular office from a typed brief, furnishes it, shows a floor plan, a 3D model and a walk-in view, checks its own plan and repairs problems, and accepts a closed set of typed edits (move, swap, resize, meeting rooms, phone booths, locks, undo). It reports what rooms and workstations fit, saves office and drawing projects in this browser, renders the 3D model on a supported GPU, exports GLB for Blender, and exports a DXF plan when asked in chat. A vector PDF can be read into a 3D building. In this worktree, a straight partition between two named, enclosed rooms in a newly imported vector plan can be moved by a stated distance and undone.
- **Does not:** generally edit rooms read from a drawing: irregular partitions, ambiguous rooms and older saved drawings without their source shapes are refused. It does not design L-shaped or multi-floor offices in the app (a prototype for L-shapes is measured in [docs/NOTCHED_LAYOUT_SPIKE.md](docs/NOTCHED_LAYOUT_SPIKE.md)), check building codes, reconstruct a real room from a photo, take voice input, or use Muse Spark yet. Projects saved in one browser do not sync to another device.
- **Not validated:** layouts are measured against our own rules; no architect has reviewed them. Realistic rendering has been measured on one Apple M1, not across devices or against photographs.

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

Code: MIT. Furniture models: CC0 from Poly Haven ([assets/LICENSES.md](assets/LICENSES.md)). Reference photos keep their own licences and credits ([apps/web/public/references/LICENSES.md](apps/web/public/references/LICENSES.md)).
