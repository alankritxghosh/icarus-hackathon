# Handoff: pre-recording QA of Icarus (4 November 2026)

Written by Claude Code at the founder's request, 4 Nov 2026, about 1:45 PM ET. Read `CLAUDE.md`, `docs/OPEN_GATES.md`, `docs/SUBMISSION_DRAFT.md` and `docs/DEMO_SHOT_LIST.md` before starting.

## Where things stand

- **Deadline:** submissions close **4 Nov 2026, 9:00 PM ET** (5 Nov, 7:30 AM IST). Leave at least one hour at the end for upload and the portal form.
- **The submission is the product demo only.** It must be **at most 3 minutes**. The founder will record it straight after this QA. A separate film project was shelved today and is not part of the submission.
- **Live site:** https://icarus.dream-studio.workers.dev. `main` is at `ede104b`; `codex/editable-drawing-demo` is fully merged (0 commits ahead). Uncommitted: `.claude/launch.json` (modified) and `docs/decisions/level-10-and-submission-scope.md` (untracked). Ask before committing either.
- **Demo script:** `docs/DEMO_SHOT_LIST.md` is a **90-second** list. It has to grow to a **3-minute** list (see the last section).
- **Not authorized by this handoff:** push, deploy, making the repo public, submitting, or any paid resource. Each needs the founder's explicit yes.

## The task

Run an extensive QA of Icarus from **six points of view**: user, developer, investor, hackathon judge, security, and privacy. Write the results to `docs/QA_REPORT_2026-11-04.md`. Rank findings P0 (blocks recording or submission), P1 (fix if under 15 minutes) and P2 (disclose or leave).

**Time box: about 2.5 hours,** then stop and hand the founder a recording go/no-go.

Rules:
- Fix P0s only, each as a small commit after `pnpm verify` passes. Do not add features. The simplicity principle in `CLAUDE.md` applies.
- Measure, don't assume. Report numbers with their limits, as `docs/OPEN_GATES.md` does.
- A check that only re-reads Icarus's own scores is not independent (engineering rule 3).

## 1. User

Use a fresh browser profile on the live site, then repeat at 390 px and 320 px wide.

1. **First impression:** the homepage, **Follow that dream**, the 35-person studio starter. Time from click to a usable model. Is the "Building your space" progress honest and calm?
2. **The three demo sentences** from `DEMO_SHOT_LIST.md`, typed exactly. Then **five off-script edits** a real office manager would type, including two impossible ones. Record what was read, what changed, and whether every collateral change was named.
3. **Plan ↔ 3D ↔ Walk:** every room view in the views strip. Walk with keyboard and touch (simulate touch on mobile). Note any camera inside a wall, or a view that is mostly wall.
4. **Make it real:** time from click to walking in baked light (the last two live runs were about 240 s). What happens if the tab is closed or reloaded mid-bake? Is the wait explained without technical captions?
5. **Exports:** GLB opens in Blender or the Khronos validator; DXF passes `ezdxf audit`.
6. **Persistence:** Projects reopen after reload. Undo works after a reload.
7. **Failure paths:** offline mode, a model timeout (if it can be simulated), an empty brief, a 2,000-character brief, a brief in another language. Does every failure say something useful?
8. **Copy:** the "concept design only" disclaimer is visible where it matters. Nothing implies code compliance, structural soundness or construction readiness. No counters or technical captions reach the customer.
9. **Accessibility:** a keyboard-only pass over the main path, focus visibility, contrast on the dark theme, and screen-reader labels on primary controls.

## 2. Developer

1. Fresh clone into a temp directory: `pnpm install`, then `pnpm verify` (types, lint, tests). Record durations and any flaky tests.
2. Follow the README "Run it" exactly with **no keys**. Does the app work on rules alone, as claimed? Then run `pnpm --filter @icarus/edge dev`.
3. `.env.example` lists every variable the code reads. Grep for `env.` and `process.env` and compare.
4. Look for dead code, unused dependencies and stale docs. Do `docs/ARCHITECTURE_ASSESSMENT.md` and `docs/DESIGN.md` still describe the code?
5. Check that every Meta call goes through `packages/meta` with schema validation, and that the deterministic fake is used in tests.
6. Check that model output never reaches geometry unchecked. Pick two paths (`/api/design/edit`, `/api/design/propose`) and trace them to the validators in `packages/core`.
7. `workers/render` and `workers/drawing` (Modal): can a developer understand what they run and what they cost, from the README and comments?

## 3. Investor

Answer in plain language, in the report:

1. What problem, for whom, and what they do today instead (a broker floor plan, a designer, a spreadsheet)?
2. What is defensible? The claim is "model proposes, deterministic engine decides". Is that visible in the product and in the demo?
3. What is measured (the edit eval at 20/20, the design loop 6.7% lower cost) and what is not (no independent designer review, one test machine)? Are any numbers presented more strongly than the evidence supports?
4. What is the next milestone a customer would pay for, and is it named honestly in the README?
5. Does the demo show a buyer moment within the first 30 seconds?

## 4. Hackathon judge

Judging: **creativity, technical ambition, whether it works** (Indie track, theme "Push the Frontier").

1. **Meta models are load-bearing.** Muse Spark 1.3 must answer live during the demo. Run one real request on the live site and confirm in the design trace which model answered: Muse Spark, or the Llama fallback. If the $5 daily cap or credits could run out during recording, say so now. Muse Voice Transcribe, SAM 3.1 and the vision critique are **not built**; the README says so and the demo must not imply otherwise.
2. **Provenance:** the first commit is after 26 Oct 12:00 PM EDT, and history is unedited. The README provenance statement is still true, including the AI-assistant credit (Claude Code and Codex).
3. **It works:** do the live link and the clean demo path run without manual repair from a fresh session? This is the most important check.
4. **Submission package:** compare `docs/SUBMISSION_DRAFT.md` with the participant portal's actual fields and rules. Is the video length limit really 3 minutes? Is a public repo required? (Making it public needs the founder's approval.) Are the licences listed?
5. Write the five questions a judge is most likely to ask, with one-line truthful answers.

## 5. Security

1. **Secrets in Git:** scan the whole history, not just HEAD, for key patterns: `sk-`, `LLM_`, `hf_`, `Bearer`, `MODEL_API_KEY=`, `OPENROUTER_API_KEY=`, Modal tokens. Use `git log -p --all | grep -E ...` with names only in the output. Confirm `.env`, `.dev.vars` and `fixtures/private/` are ignored and were never committed.
2. **Worker routes** (`apps/edge/src/index.ts`): `/api/design/propose`, `/api/design/revise`, `/api/design/edit`, `/api/drawing/views`, `/api/read-photo`, `/api/render`. For each, record:
   - the input size limits
   - content-type checks
   - method checks
   - error messages that leak internals
   - rate limits

   Drawing and render have per-caller and global rate limits (`wrangler.jsonc`). Check whether the three design routes and read-photo have any limit beyond the $5/day KV budget.
3. **Denial of wallet:** can an anonymous caller burn Muse Spark spend or Modal GPU time? Is the daily cap enforced before or after the call? (`docs/META_CREDITS.md` notes one call can overshoot.) Are the Modal endpoints callable directly, bypassing the Worker, or do they need a shared secret?
4. **Untrusted input:**
   - PDF parsing in the drawing worker: zip bombs, huge pages, malformed files.
   - Photo upload: type and size checks.
   - Prompt injection in a brief or edit: can the text make the model emit operations that bypass the validators?
   - XSS: is model text rendered as HTML anywhere in the chat?
5. **Headers:** CORS policy on `/api/*`, and whether there's a CSP. Note any clickjacking exposure, but don't over-engineer a fix.
6. **Dependencies:** run `pnpm audit`, and list the high and critical findings with whether each is reachable.

## 6. Privacy

1. **What leaves the browser, and to whom:**
   - brief and edit text go to Meta's Model API or Cloudflare Workers AI
   - photos go to Workers AI (Llama 4 Scout)
   - PDFs go to the Modal drawing worker
   - scenes go to the Modal render worker

   Is this disclosed anywhere a user would see it? Is Meta's Contributor mode (training on content) **off**? The code default is the standard `muse-spark-1.3` (`packages/meta/src/types.ts`, `DEFAULT_MODEL`), and no `-contributor` model appears in the source. Check that the deployed Worker has no `ICARUS_MODEL` override pointing to a contributor variant.
2. **Storage:** projects and learned preferences live in this browser only (localStorage or IndexedDB). Is there a way to clear them? Is anything stored server-side (KV holds the budget only)? Do the Worker or Modal logs keep request bodies?
3. **Private material:** the founder's two-floor residential plans in `fixtures/private/two-floor-reference/` are ignored by Git. The plan owner agreed to showing the floors in submission media, but not to committing them (`docs/decisions/level-10-and-submission-scope.md`). Check that no derived image or route data from them is tracked, and that the demo does not use them unless the founder decides to.
4. **No analytics or third-party trackers** on the live site. Check the network tab on load.
5. **Key rotation:** recommend the founder rotates the Meta Model API key and other development tokens **after submission**. Rotating the key the live Worker uses stops the live demo until the secret is updated, so do it after recording.

## After QA: the 3-minute demo script

Extend `docs/DEMO_SHOT_LIST.md` from 90 s to **at most 3:00**. Keep its rule: only sentences that were measured, and cut any shot that misbehaves in a rehearsal run.

A suggested shape for the founder to approve:

| Time | Beat |
|---|---|
| 0:00–0:20 | The problem, in one sentence, and the homepage |
| 0:20–0:50 | Starter brief, with Muse Spark proposing what the brief left out |
| 0:50–1:30 | Edits by words, a refusal, and collateral changes named |
| 1:30–2:05 | Plan, 3D and Walk |
| 2:05–2:35 | Make it real (cut the wait) |
| 2:35–2:50 | Exports, and how it works: "the model proposes, the engine decides" |
| 2:50–3:00 | End card: `icarus`, "Concept design only" |

The voice-over may say "Icarus", but on-screen text uses the lowercase `icarus` wordmark. Rehearse once on the live site and record the Make it real bake beforehand.

## Hand back to the founder

1. `docs/QA_REPORT_2026-11-04.md`, with findings ranked P0, P1 and P2 and the P0 fixes made.
2. The updated 3-minute `DEMO_SHOT_LIST.md`.
3. A one-line recording **go/no-go**, and the exact live-site state (commit, and whether a redeploy is needed and approved).
4. A daily log line in `docs/HACKATHON.md`.
