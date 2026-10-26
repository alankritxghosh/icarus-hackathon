# Hackathon plan and log

Track: **Indie developer**. Theme: **Push the Frontier**. Kickoff Mon 26 Oct 2026 12:00 PM EDT. Submission due **Wed 4 Nov 2026, 9:00 PM EDT**. Demo-ready target: Mon 2 Nov.

## The product

An engineer describes a mechanical thing in words, shows a photo, or speaks. Icarus returns a real parametric assembly (STEP and GLB) with every assumption and unknown visible, checks its own output, and changes the design when told to, rebuilding only what changed. Concept geometry only; readiness gates fail closed.

## Pipeline

1. **Understand** (Muse Spark 1.3): words and photo to a typed design spec through structured output.
2. **Measure** (SAM 3.1 + Muse Spark grounding): segment the components in the photo, turn pixel proportions into dimensions against one known length, with stated uncertainty.
3. **Solve** (deterministic, `packages/core`): place parts by explicit constraints; reject anything the solver cannot place.
4. **Build** (CadQuery worker): B-Rep solids, STEP assembly, GLB.
5. **Validate** (independent): re-read the STEP, compare volumes with analytic formulas, check interference and structure.
6. **Revise** (Muse Voice Transcribe + Muse Spark tool calls): speech or text becomes validated parameter changes; the diff shows what changed and that the rest did not drift.

## Schedule

- 26 Oct: scaffold, Meta adapter with fake and contract tests.
- 27 Oct to 28 Oct: design-spec schema, solver, constraint model.
- 29 Oct: CAD worker and independent validation.
- 30 Oct: photo path (grounding and SAM), revision by tool calls.
- 31 Oct to 1 Nov: web app, voice, one reliable golden path, polish.
- 2 Nov: freeze, three-minute video, README. 3 to 4 Nov: buffer and submit.

## Daily log

### 26 Oct (kickoff day)

- Created this repository after kickoff. Workspace, license, provenance statement, project rules.
- Wrote the Meta Model API adapter (`packages/meta`) from the public docs: bearer-authenticated transport with timeouts and retries (rate limits honour Retry-After), Responses API wrapper with schema-constrained output validated again on our side, a bounded tool-calling loop that validates arguments before anything runs, vision grounding (points and boxes on the 0 to 1000 grid), SAM 3.1 segmentation parsing, and a deterministic fake that applies the same validation as the real client.
- 18 contract tests pass against the documented request and response shapes. Two live smoke tests exist and are skipped until `MODEL_API_KEY` is set, so **nothing here has yet been confirmed against the real API**.
