# North star and 30-hour cut

31 October 2026. This is a planning note, not a claim that the work below ships.

## The user journey

Describe a space or attach a plan → get a result that states what it achieved → request a change → export a design another person can continue working on.

The 30-hour target is **one reliable office concept journey**, with a named, repeatable drawing-import demonstration if the supplied plan is supported. It is not arbitrary-plan reconstruction, general CAD, universal 3D creation, cloud collaboration, or construction-ready output. GLB is a visual scene; DXF is an editable 2D plan, not a semantic building model.

## Capability failure to keep visible

The 12-person starter states a 14 × 10 m shell and requests two meeting rooms, one phone booth, kitchen, reception, two restrooms, and 12 workstations. A local rules-fallback run placed only **5 of 12 workstations**. A separate model-assisted browser QA run reported 12 of 12. The result depends on the route and needs an acceptance check across both. Enlarging the stated shell without asking would change the user's facts; an attempted workspace enlargement was refused because the minimum rooms needed about 136 m² while the shell offered about 129 m² after circulation. The current summary reports the shortfall but gives no tested way to resolve it. Evidence: `docs/HACKATHON.md`, `docs/QA.md`, and `docs/reference/design-loop-eval/run3-final-llama-workers-ai.json`.

This is a P0 product failure whenever a design is presented as fulfilling the brief. Keep the starter and its failure in the evaluation set until both the geometry and the reply have been checked independently.

## Ways to increase capability, in order

1. **Recover from an impossible brief.** Use the existing `fitShell` and `suggestFixes` evaluation path to offer a verified larger shell or a specific room trade-off in the conversation. Accept only the option the user chooses, then regenerate and recount placed desks. Never silently change a stated shell or remove a requested room. Also inspect whether the layout search can fit the stated program more efficiently before declaring it impossible.
2. **Check the built result against the brief.** Independently count rooms, placed desks, booths, entrances, and exported geometry. Distinguish requested, built, and still missing. A passing internal score is insufficient. Preserve the original brief for comparison after edits.
3. **Make prompt edits predictable.** For each accepted edit, name what changed and check that unrelated rooms did not move without disclosure. Keep undo and saved conversation working after reload.
4. **Treat imported plans as a separate maturity level.** The real sheet closes 5 of 23 labelled rooms; the isolated worktree moves one clear straight partition. Demonstrate only that supported case, retain the source drawing and uncertainty, and report unsupported plans plainly. Broader wall and opening recovery needs its own benchmark before a general claim.
5. **Prove handoff.** Open the exported GLB in Blender and DXF in an independent CAD reader; compare object and room counts to the app. State that the DXF is a plan and the GLB is a mesh scene. Shared, semantically editable projects are later work.

## 30-hour execution order and gates

| Time budget | Work | Gate before moving on |
|---|---|---|
| 0–5 h | Reproduce the starter with model available and unavailable; inventory the full requested program and the actual scene. | Independent count and screenshots stored with the run. |
| 5–13 h | Implement a conversational, measured recovery offer for unmet hard requirements; improve search only if measured feasible candidates exist. | No silent brief changes; accepting an offer regenerates; refusal preserves the current design. |
| 13–19 h | Test brief → edit → undo → save/reopen on desktop and narrow mobile; check unintended room movement. | Every requested item is built or explicitly marked missing; state after reopen matches state before close. |
| 19–24 h | Exercise the isolated drawing-edit worktree on its supported fixture; validate GLB and DXF in independent tools. | Drawing edit, undo, reopen, and both exports complete in a browser without hidden omissions. |
| 24–30 h | Run a three-minute demo without manual repair; fix P0 blockers; freeze claims and record remaining gaps. | A fresh user can complete the supported journey from the first screen. |

Meta model access and the actual hackathon submission are separate gates in `docs/META_CREDITS.md` and `docs/HACKATHON.md`. If access becomes available during this window, smoke-test the live route before claiming it in a demo. Do not trade a broken core journey for a new model or rendering feature.

## Decision at the cut

Call the narrow journey ready only if the starter's requirements are independently accounted for, a failed brief has a tested next action, one prompt edit survives undo and reopen, and the exports open outside Icarus. If any gate fails, demonstrate the supported part and say which step remains open. The full north star requires reliable arbitrary drawings, broader edits, and a genuinely editable project handoff beyond this cut.
