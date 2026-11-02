# Next session: from working parts to a submitted product

Written 3 Nov 2026 for the session that follows. Submissions close **4 Nov 2026, 9 PM ET (5 Nov, 6:30 AM IST)**.
Work on branch `codex/editable-drawing-demo` in `/Users/alankritghosh/icarus-editable-drawing-demo`. Live site:
https://icarus.dream-studio.workers.dev (Worker `icarus`, Cloudflare account subdomain `dream-studio`).

Do the steps in order. Each ends with a check that is measured, not looked at. Run `pnpm verify` before every commit.
**F** marks what only the founder can do (keys, secrets, the review, recording); **A** marks agent work.

## Where things stand (checked 3 Nov)

- The live Worker has only `RENDER_WORKER_URL` and `RENDER_WORKER_TOKEN`. With no `MODEL_API_KEY`, the live design
  route falls back to Workers AI (Llama 3.3 70B), not Muse Spark. All Muse Spark numbers so far came from a local Worker.
- The $5 daily cap is counted in process memory unless a KV namespace is bound as `BUDGET` (`apps/edge/src/design.ts`).
- The branch is 56 commits ahead of `main`; `main` is 1 commit ahead. 86 files differ.
- Office designs offer only their entrance in Walk (`apps/web/src/App.tsx:687`), so "Go to a room" and the views
  strip are empty on the demo path.
- The Meta key was pasted into chat on 2 Nov. Rotate it before it goes on the public site.

## 1. Muse Spark on the live site (about 1 hour)

1. **F** Create a new key in the Meta Model API dashboard; revoke the old one once the new one works.
2. **F** Put it in `apps/edge/.dev.vars` (replacing `MODEL_API_KEY`), then upload it without printing it:
   ```bash
   cd apps/edge && grep "^MODEL_API_KEY=" .dev.vars | cut -d= -f2- | tr -d '\n' | npx wrangler secret put MODEL_API_KEY
   ```
3. **A** Create the budget store and bind it: `npx wrangler kv namespace create BUDGET`, then add the printed id to
   `wrangler.jsonc` as `"kv_namespaces": [{ "binding": "BUDGET", "id": "<id>" }]`.
4. **A** Add the settings that are not secret to `wrangler.jsonc` `vars`: `ICARUS_PROVIDER=meta`,
   `ICARUS_DAILY_BUDGET_USD=5`, `ICARUS_PRICE_IN_USD_PER_MTOK=1.25`, `ICARUS_PRICE_OUT_USD_PER_MTOK=4.25`.
5. **A** Deploy with the founder's approval; then design one starter brief on the live site.

**Done when:** the live design trace names `muse-spark-1.3` (not Llama), the KV store shows a non-zero spend for the
day after that design, and a second Worker instance (any later request) reads the same spend.

## 2. One demo path, made flawless (about 5 hours)

The path: **brief → Muse Spark proposal → edit by words → walk → Make it real**, on the 35-person studio starter.
Fix only what this path shows, in this order:

1. **A** Room views for office designs: pass every plan viewpoint to Walk, not only the entrance (`App.tsx:687`), so
   "Go to a room" and the views strip work. Test: the 35-person design offers at least its open studio, a meeting
   room and the kitchen, and each lands on floor clear of furniture (the same check as the drawing room views).
2. **A** Room camera: in 3 of 5 captured room views the third-person camera saw mostly wall. Measure first: for each
   room view, the share of the frame covered by wall meshes; target under 40%. Change only what moves that number.
3. **A** Furnishing that reads from above: rooms look empty in the overview. Measure the furnished share of each room's
   floor area against the program's kit; raise density only where a kit is placed below its own target.
4. **A** Edit by words on the demo design: run the 20-sentence edit eval once against the live Worker (spend under
   $1) and keep the result file. Target: 16/16 doable, 4/4 refused, as on 2 Nov.
5. **A** Make it real on this path: measure cold and warm render times on the live site three times each, and record
   them in `docs/REALISTIC_RENDERING.md`.

**Done when:** a person can run the whole path on the live site without a dead end, and each number above is recorded.

## 3. Merge, then tell the truth in the README (about 2 hours)

1. **A** Merge `main` into the branch (it is 1 commit ahead), run `pnpm verify`, then merge the branch into `main` with
   the founder's say-so. Never rewrite history.
2. **A** README: what Icarus does today, which Meta models are used and for what, with the measured numbers and their
   limits (from `docs/META_CREDITS.md`, `docs/REALISTIC_RENDERING.md`). Remove or mark anything not built: spoken edits
   (Muse Voice Transcribe) and SAM are not in the product.
3. **A** `docs/SUBMISSION_DRAFT.md`: the same facts, the live URL, and the concept-design-only statement.
4. **F** Read both and approve.

**Done when:** `main` holds the branch, verify passes on `main`, and every claim in the README points to a file that
measured it.

## 4. Demo video and the homepage button (about 2 hours)

1. **A** Write a 90-second shot list for the demo path (step 2), with the exact brief and edit sentences to type.
2. **F** Record it on the live site.
3. **A** Add "Watch the demo" to the homepage only once the video exists, and link it from the README.

**Done when:** the video plays from the homepage and the README.

## 5. The independent review, or an honest note (in parallel, from now)

1. **F** Send Bharath `fixtures/private/two-floor-reference/REVIEW_SHEET.md` today, due by the morning of 4 Nov IST.
2. **A** If his signed sheet arrives, record his verdict and any changes in `docs/decisions/` and close Level 10.
3. **A** If it does not arrive in time, the submission says plainly: the walkthrough was not independently reviewed,
   and the founder is not independent of the work.

## Not in this session

Spoken edits, SAM, accounts and sharing, textured renders of multi-floor projects, and splitting `Studio.tsx`. Each is
real work; none is needed for the submission.

## Risks to watch

- The render route is public; its only guard is rate limits per Cloudflare location. Watch Modal spend daily.
- Modal's L4 GPUs ran out on 2 Nov; the worker falls back to A10G and L40S, which cost more per second.
- Local DNS on the founder's Wi-Fi may still cache the old subdomain; test the live site on mobile data too.
