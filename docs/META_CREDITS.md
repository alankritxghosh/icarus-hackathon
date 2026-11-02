# Using Meta credits (from 1 November 2026)

Credits are on Meta's own platform (the Meta Model API). OpenRouter stays on as the free development route until then. This is the runbook, so the first day with credits produces measurements instead of setup.

## What is already built

- **Provider switch.** `ICARUS_PROVIDER=meta` or `openrouter` chooses the route even when both keys are set. Without it the old behaviour holds (an OpenRouter key wins). A typo or a missing key gives no model rather than the wrong one.
- **Spending limit.** The Meta route is paid, so it is wrapped in `BudgetedMeta`: it counts each call's cost from the token counts Meta reports and stops at a daily limit (UTC day). **It will not run at all** until `ICARUS_DAILY_BUDGET_USD`, `ICARUS_PRICE_IN_USD_PER_MTOK` and `ICARUS_PRICE_OUT_USD_PER_MTOK` are set. One call can overshoot the limit by its own cost, so set the limit below what you can afford to lose.
- **Free fallback.** When the paid route is refused, busy or down, the free Workers AI route (Meta's Llama 3.3 70B) answers, and the Worker log says which route was not used. The design trace in the app shows which model answered.
- **Tests with no spend.** Provider choice, the limit (including a new day and a failed call costing nothing) and the Worker wiring are tested with fakes.
- **Two evaluations ready to run** (below), one of them new.

## Setup (you, once)

Put the key in `apps/edge/.dev.vars` (ignored by git) and, for the live tests, export it in your shell. Never paste it in chat, a commit or a screenshot.

```
MODEL_API_KEY=...                       # Meta Model API key
ICARUS_PROVIDER=meta
ICARUS_DAILY_BUDGET_USD=...             # your cap
ICARUS_PRICE_IN_USD_PER_MTOK=...        # from Meta's price list
ICARUS_PRICE_OUT_USD_PER_MTOK=...
# leave OPENROUTER_API_KEY in place; it is the free route and is not used while ICARUS_PROVIDER=meta
```

Start the Worker with `pnpm --filter @icarus/edge dev` (port 8789). Spend is counted in memory for the life of that process unless a KV namespace is bound as `BUDGET`; restarting the Worker resets the count, so for a real cap in a deployed Worker bind KV first.

## Order of work, with the measurement each step produces

1. **Smoke test the live API** (`packages/meta/test/live.test.ts` runs when the key is present). Finds out what Meta's API actually supports: schema-constrained output, conversation state, image input, tool calls, the real prices. Anything the adapter assumed and Meta does not do is fixed here, before spending on evaluations.
2. **Design loop on the 12 briefs.** `EVAL_EDGE=http://localhost:8789 EVAL_OUT=docs/reference/design-loop-eval/run4-muse-spark.json pnpm --filter @icarus/web exec vitest run test/eval/designLoop.eval.test.ts`. Compare with `run3-final-llama-workers-ai.json` (rules alone 655, repair loop 371, with the free live model 362). The question is whether a stronger model beats 362, and by how much.
3. **Reading free-form edit requests.** `test/eval/editModel.eval.test.ts` (new): 20 sentences the typed grammar cannot read (synonyms, several requests in one, things that cannot be done), with the operations a careful person would expect and a scorer that is itself tested. Run it once on the free route and once on Muse Spark with the same command and a different `EVAL_OUT`; the files give valid-answer rate, correct-reading rate and whether impossible requests are flagged instead of guessed at.
4. **Picture quality** (the weakest part of the product, rated about 5 out of 10). Try the best image route Meta offers for "Make it real" and compare against the Workers AI repaint on the same views, by eye and with designers.
5. **Not built yet, only if time allows:** a Muse Spark critique of a render against the plan, voice input, and object finding on a photo. Each needs code before it needs credits.

## Results (2 November 2026)

Run on `muse-spark-1.3` (standard mode) through a local Worker with the Workers AI binding removed, so a failed Meta call shows as a failure instead of falling back to Llama. Each result file names the model that answered.

**Three faults found and fixed before the numbers counted:**
1. **Reasoning effort was never sent to Meta.** The adapter assumed Meta ignores it. Meta documents `reasoning.effort` for Muse Spark and counts reasoning against `max_output_tokens`, so the 3,000-token proposal was cut off twice and the design fell back to rules. It is now sent on both routes.
2. **Meta honours only the first branch of a union** in structured output. Measured live: "add two phone booths" against a two-branch union came back as the first branch, `move_room` with an empty room, on both tries. The edit and repair-patch schemas are unions, so Muse Spark could only ever move, remove, lock or unlock. Sending `anyOf` instead of `oneOf` did not help (8/16). `packages/meta/src/flatten.ts` now sends each discriminated union as one flat object with every field required, and cuts the answer back to the chosen branch before the zod type checks it.
3. **Output limits were too small for a reasoning model.** Propose, revise and edit now allow 6,000, 5,000 and 3,000 output tokens. Meta bills only the tokens used.

The evaluation's own fetcher retries once on a network error: twice, a request to the local Worker failed before arriving because Node reused a closed idle connection.

**Reading free-form edit requests** (`docs/reference/edit-model-eval/`, 20 sentences, of which 16 are doable and 4 impossible):

| Run | Usable answers | Doable read right | Impossible flagged |
|---|---|---|---|
| run1, as built | 20/20 | 7/16 | 4/4 |
| run2, `anyOf` | 20/20 | 8/16 | 4/4 |
| run3, flat unions, 1,200-token limit | 16/20 | 12/16 | 4/4 |
| **run4, flat unions, 3,000-token limit** | **20/20** | **16/16** | **4/4** |

Median 7.2 s per request in run4. There is no free-Llama run of this test to compare with: the Workers AI route needs a Cloudflare login, which had expired.

**Design loop on the 12 briefs** (`docs/reference/design-loop-eval/run4-muse-spark.json`; lower cost is better):

| Variant | Total cost |
|---|---|
| Rules alone (A) | 655.3 |
| Repair loop, no model (B) | 371.3 |
| Repair loop with free Llama 3.3 70B (run3) | 361.8 |
| **Repair loop with Muse Spark 1.3 (C)** | **346.5** |

Muse Spark lowered the total by 6.7% against the loop without a model and by 4.2% against Llama. Per brief it is mixed: better on 4 (for example demo studio 11.5 to 3.7, startup 12 82.2 to 66.2, agency 22 north 69.2 to 62.3), worse on 4 and level on 4. Where it was worse, the plan without a model was already near zero (law firm 0.0 to 3.3, small studio 0.1 to 3.6). Over the 12 briefs it proposed 57 decisions, of which the validators refused 7; all 17 revision answers were valid and 9 were used. Median 35 s per brief. Each brief ran once, so the per-brief numbers include the model's run-to-run variation (an aborted earlier run scored demo studio 11.4).

Spend was not metered per call here: the Worker's daily count lives in memory and reset at each restart. All runs together, including probes and aborted runs, are estimated at about $2. Check the Meta dashboard for the real figure.

## What counts as a result

Report the numbers whichever way they go. The free model added very little to the design loop (362 against 371 without it), so Muse Spark may add little too; the product has to be good without it. The README and the demo must say only what was measured.

## Release checklist for 2 November

- The README states exactly which Meta models are used, from the runs above.
- Make the repository public again (it is private for stealth) after checking the README, the licence files and that nothing private was added.
- Rotate or remove any key that touched a shared place; confirm `.env` and `.dev.vars` are still ignored.
