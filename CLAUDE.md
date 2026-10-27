# Icarus hackathon project rules

This repository is a fresh build for the Meta Global AI Developer Hackathon, Indie developer track. Read `docs/HACKATHON.md` first.

## Provenance rules (never break these)

- Every file here is written new, after the kickoff on 26 Oct 2026 12:00 PM EDT. Do not copy files, code or tests from the earlier private prototype (kept private, outside this repository). Write from the design, not from the old source.
- Never rewrite Git history or set commit dates. Commit as the work happens.
- The README provenance statement must stay true. Update `docs/HACKATHON.md` daily log as milestones land.

## Scope

- One product, one goal: design an entire office space from scratch (program, floor plan, walls with openings, furniture, lighting, materials), walk through it in 3D, and change it by typing or speaking. `docs/DESIGN.md` defines the demo test. Nothing else is in scope until that works.
- Meta models are load-bearing, not decoration: Muse Spark 1.3 (program extraction with structured output, vision critique of renders, tool calls for edits), Muse Voice Transcribe (spoken edits), SAM 3.1 and grounding (reading an existing floor plan, if time allows). Every call goes through `packages/meta` with schema-validated responses and a deterministic fake for tests.
- A model may only propose. The deterministic layout engine and validators in `packages/core` decide what is accepted, and they never draw geometry from model output unchecked.
- This is concept design. Never imply building-code compliance, structural soundness or construction readiness in copy, fixtures or demos.

## Engineering rules (founder, 28 Oct 2026; full text and audit in `docs/ENGINEERING_RULES.md`)

1. Nothing enters the architecture that the founder cannot have explained: what it does, why it exists, what it assumes, what can go wrong.
2. Every major engineering decision has evidence: real alternatives, trade-offs and an experiment. No technology is adopted because an AI agent says it is good.
3. Every major subsystem has an independent test (known geometry, external architectural evaluation, measurable reference geometry, tests for unintended changes). "The demo looks right" is not a test. A check that reuses the code's own score is not independent.

## Working rules

- pnpm workspace: `packages/core` (program, layout, build, edits, evidence), `packages/meta`, `apps/server`, `apps/web`.
- Run `pnpm verify` before committing a milestone. Commit small, coherent checkpoints with clear messages.
- Never print, commit or expose secrets (`MODEL_API_KEY`). Names only in `.env.example`.
- Do not push, make the repository public, deploy, or create paid resources without the author's explicit approval.
- Check outputs, not just success: read generated files back with an independent reader. Report measured numbers with their limits.
