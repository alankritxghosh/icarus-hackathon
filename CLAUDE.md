# Icarus hackathon project rules

This repository is a fresh build for the Meta Global AI Developer Hackathon, Indie developer track. Read `docs/HACKATHON.md` first.

## Provenance rules (never break these)

- Every file here is written new, after the kickoff on 26 Oct 2026 12:00 PM EDT. Do not copy files, code or tests from the earlier private prototype in `/Users/alankritghosh/Icarus-Follow That Dream`. Write from the design, not from the old source.
- Never rewrite Git history or set commit dates. Commit as the work happens.
- The README provenance statement must stay true. Update `docs/HACKATHON.md` daily log as milestones land.

## Scope

- One product: words, a photo and voice become a constrained parametric CAD assembly with real STEP and GLB export, independent validation, and revision by talking.
- Meta models are load-bearing, not decoration: Muse Spark 1.3 (structured output, vision grounding, tool calls), SAM 3.1 (segmentation), Muse Voice Transcribe (speech). Every call goes through `packages/meta` with schema-validated responses and a deterministic fake for tests.
- A model may only propose. The deterministic solver and validators in `packages/core` decide what is accepted.
- Output is concept geometry. Readiness gates (structural, thermal, propulsion, controls, manufacturing, flight, certification) fail closed without independent, qualified evidence. Never imply otherwise in copy, fixtures or demos.

## Working rules

- pnpm workspace: `packages/core`, `packages/meta`, `apps/server`, `apps/web`, `workers/cad`.
- Run `pnpm verify` before committing a milestone. Commit small, coherent checkpoints with clear messages.
- Never print, commit or expose secrets (`MODEL_API_KEY`). Names only in `.env.example`.
- Do not push, make the repository public, deploy, or create paid resources without the author's explicit approval.
- Check outputs, not just success: read generated files back with an independent reader. Report measured numbers with their limits.
