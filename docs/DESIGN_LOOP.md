# The propose, solve, validate and repair loop

Icarus does not trust a model with geometry, and does not trust its own rules to be complete. The loop
puts each where it is strong, and lets measurement decide.

```
brief ──► deterministic reader ──► stated facts (never overridden)
                │
                ▼
       model proposes what the brief left open        ◄── knowledge file (office.v1.json)
       (counts, extra rooms, neighbour wishes, why)        the same rules the solver and validator use
                │
                ▼
       merge: stated facts win; model additions are measured
              against the rules-only plan and set aside if worse
                │
                ▼
       solver lays out ──► validator measures ──► structured issues
                ▲                                       │
                │                                       ▼
                └──── patch (model first, then rules) ◄─┘   kept only if the measured score falls
                                                         
       what no patch can fix ──► suggestions, each planned and checked first
```

## Where the knowledge lives

`packages/core/src/knowledge/office.v1.json`: room sizes, adjacency wishes, daylight needs,
circulation widths, workstation clearances and validator thresholds, each citing a listed source. Most
are labelled "icarus-default" because that is what they are; the minimum clear route and door opening
cite the 2010 ADA Standards as floors, not as a compliance claim. A schema refuses a file that cites an
unknown source or inverts a threshold. The solver, the validator and the model's instructions all read
this one file, so they cannot disagree.

## What the model may and may not do

- **Propose** (`ProposalSchema`): counts the brief did not state, a few extra rooms, neighbour wishes,
  an area bias, and a reason for each decision. `mergeProposal` refuses to override anything the brief
  states and records what it refused.
- **Revise** (`PatchSchema`): a closed vocabulary: bias a room's area, prefer or avoid a neighbour, enlarge
  a shell whose size was only assumed. It cannot add or remove rooms, shrink a shell, change a stated
  shell or change the headcount.
- Every answer is validated against a schema, in the Worker and again in the browser. A model that is
  absent, busy, wrong or slow changes nothing about correctness: the rules take over.
- A change, from the model or the rules, is kept only if the measured score falls. The plan is never
  worse than where it started, and this is tested with the safeguards removed to prove the tests can fail.

## What the loop cannot fix, and says so

When the rooms cannot fit a shell the user stated, the honest output is not a quiet change to their
facts. The loop offers concrete options (enlarge the shell to W x D, or drop named optional rooms), and
each option was planned and measured before it was offered. An early version computed these from area
arithmetic and offered fixes that left 8 issues open; they are now results, not guesses.

## Limits

- The model's proposals are only as good as the model. On the free tier that is a small open model;
  Muse Spark has not been tested here (no credits).
- The solver arranges rooms in rows and corridors; some failures (a room that cannot reach a window in a
  given shell) are a limit of that arrangement and of the area bias, not of the model.
- The scores are Icarus's own planning measures, not building-code results.

## Evaluation (27 Oct 2026)

Twelve briefs (`apps/web/test/eval/briefs.ts`: stated and unstated shells, tight and roomy, every entrance
side, 8 to 60 people), three variants each: **A** the rules alone with no repair, **B** the repair loop
without a model, **C** the full loop with a live model proposing and revising. Score is the loop's own
measure (lower is better: failures cost more than warnings, scaled by how short). Reproduce with
`EVAL_EDGE=http://localhost:8789 EVAL_OUT=out.json pnpm --filter @icarus/web exec vitest run test/eval`;
results of all three runs are in `docs/reference/design-loop-eval/`.

| Variant | Total score | Open issues | Failures |
| --- | --- | --- | --- |
| A rules alone | 655.3 | 77 | 11 |
| B rules + repair loop | **371.3** (-43%) | 49 | 6 |
| C model + repair loop (final run) | **361.8** (-45%) | 51 | 5 |

- **The repair loop is what delivers.** B beat A on 5 briefs and was never worse. The large wins were an
  unstated shell sized to fit its program (a small studio went from 1 of 8 seats placed to 8 of 8) and a
  missed adjacency fixed by asking the solver for it (score 15.2 to 0.3).
- **The model added little that the measurements can see.** In the final run the model took part in 8 of 12
  briefs (Meta Llama 3.3 70B on Workers AI). Against B it was better on 1 (a tight 12-person startup placed
  12 of 12 seats instead of 5), worse on 1 (by 0.1, within tolerance) and equal on 10. Of 10 revisions it
  suggested, all valid, 2 measured as improvements and were kept. Its main contribution is the reasoned
  decisions shown to the user, which are explanation and not measured quality.
- **Time:** about 5 s without a model, about 21 s with one.

### What the three runs taught us

1. **Run 1** (free OpenRouter model, before a fix): C scored 382.9, worse than B (371.3). The loop was
   keeping the model's neighbour wishes without measuring them, so a model-assisted plan could start worse
   than rules alone (a studio at 18.8 against 11.7). Fixed: every model-derived variant is measured against the
   rules-only plan and the design falls back step by step. A hostile-proposal test now guards it and was
   mutation-checked (it fails with the old behaviour: 40.3 against 12.2).
2. **Run 2** (after the fix): the free model was rate limited for all 12 briefs ("free-models-per-day"; OpenRouter
   gives about 50 free requests a day without credits), so C equalled B exactly in every row. That is the
   graceful-degradation guarantee holding, and no evidence about the model.
3. **Run 3** added a second free route (Meta Llama 3.3 70B on Workers AI) as an automatic fallback, which
   fixed availability (8 of 12 proposals instead of 0); 2 briefs still got no answer from the service and 2 got
   an answer outside the schema, all handled by falling back to the rules.

### Honest limits of this evaluation

- The score is the same measure the loop optimises, so a lower score shows the loop does what it is built to do,
  not that the offices are independently better. No human or outside judgement was used.
- One run per brief, a model that is not deterministic, and twelve briefs: the differences between B and C are
  within noise. Treat "the model adds little" as the finding for this small free model, not as a verdict on
  Muse Spark, which has not been tested (no credits).
- Four of the twelve briefs ended with failures no change could fix inside the shell the user stated; for those
  the loop's output is a verified suggestion for the user to accept, not a repaired plan.
