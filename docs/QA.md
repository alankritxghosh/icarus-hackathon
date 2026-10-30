# Icarus QA: test what a person can trust

31 October 2026. This is the working QA plan for the current office design, drawing import, editing, viewing, saving and export flows. A passing `pnpm verify` is necessary, but it does not prove that a design satisfies a brief or that the app works in a browser.

## What to check

| Layer | Test and evidence | Release failure |
| --- | --- | --- |
| User journey | Build each starter and a free-form brief in a browser. Read the reply, inspect Plan and Walk, edit, undo, save, reload, reopen, export. Repeat at desktop and 390/320 px. Record screenshots and actual words shown. | A stated request silently disappears; a control cannot be used; a saved design is lost. |
| Design truth | Compare the requested program with an independently counted room/seat/booth inventory from the built plan. Test known hand-drawn geometry for overlap, containment, openings, reachability and door clearance. Preserve the original brief beside the result. | The reply claims a room or seat that the plan does not contain, or conceals a shortfall. |
| Edits | On the twelve-brief corpus, compare each requested operation with the resulting room rectangles and the reply. Check unrelated rooms and locked rooms independently, not with the solver's score. Include conflicting and unsupported requests. | An unrelated room moves without being reported, or a refused edit changes the plan. |
| Drawing import | Use a small set of real vector PDFs with measured dimensions and hand-counted labelled rooms, doors and windows. Compare the reconstructed model and explicit unknowns to the sheet. Try missing scale, raster-only, damaged and oversized PDFs. | Icarus states an inferred wall or scale as measured, or says an unclosed room was read faithfully. |
| Exports and recovery | Open DXF with an unrelated CAD reader and GLB with the Khronos glTF Validator, compare room/geometry counts, and reopen the files in an authoring app. Test one corrupt stored project among valid ones. | Export cannot be read; an omitted part is not disclosed; one damaged save hides other projects. |
| Device and access | Run 3D, Plan and realistic mode on a supported and an unsupported GPU; test keyboard focus, labels, zoom, and narrow layouts. Automated accessibility checks can help, followed by a manual keyboard and screen-reader pass. | A visible control cannot be used, the app promises rendering it cannot provide, or the result is inaccessible through the intended controls. |
| Failure and speed | Simulate slow/offline model and drawing services, storage unavailable/full, and repeated clicks. Measure time to useful plan, frame rate and memory on named devices; record sample count, device and limits. | A service failure destroys the current design, blocks the rules-only path, or leaves indefinite progress. |

## How to run it

1. Run `pnpm verify` and `pnpm --filter @icarus/web build`. These are code gates, not product acceptance.
2. Run the existing offline edit evaluation with `EDIT_EVAL_OUT=/tmp/icarus-edit-eval.json pnpm --filter @icarus/web exec vitest run test/eval/edit.eval.test.ts`. Read the JSON for refusals, unexpected changes and timing. This evaluation uses Icarus's own score, so do not treat a lower score as independent proof of quality.
3. Run the user journey on local web and inspect the actual view at desktop, 390 px and 320 px. Keep a short evidence record: brief, device, expected, observed, screenshot or file, severity, fix and retest.
4. For each release candidate, test three real drawings and one independently reviewed office brief. Ask an architect or designer to judge usefulness and omissions without showing Icarus's score. This cannot be replaced by a unit test.
5. Only after the manual journey is stable, automate the repeated browser path with Playwright. Start with semantic assertions and two stable screenshots; avoid treating a pixel match as proof of geometry. Add axe checks, then manual accessibility review. This is a proposed next tool adoption, not a new dependency today.

Prioritize P0 for lost work, false claims about geometry or a broken primary flow; P1 for a blocked edit/import/export or unusable mobile controls; P2 for recoverable visual and copy defects. Every fixed bug gets a reproduction, a regression check where useful, and a browser retest when it affects the interface.

## Findings in this run

- **P1 fixed:** at 390 px the stage buttons overlapped; at 320 px they took three rows over the model. The mobile controls now wrap into two rows without overlap. Checked at both widths in the local browser.
- **P1 fixed:** one malformed saved office entry or revision could make `loadBuilds` return no projects. It now skips the bad entry and retains valid ones; covered by a regression test.
- **P2 fixed:** a valid `.pdf` with an empty browser MIME type went down the photo route. It now goes to the drawing reader. The failure path still needs a real PDF browser retest.
- **Passed in the local browser:** the 12-person starter built eight rooms; its reply said 12/12 workstations and 1/1 phone booths fit. New, Projects and reopen restored the conversation and model. This is one brief on one browser, not a design-quality conclusion.
- **Offline edit evaluation:** 158 requests on 12 briefs produced 86 applied, 36 already-satisfied and 36 refused outcomes; it reported zero new failures under Icarus's own rules. The 36 refusals include 15 attempts to move reception away from the entrance lobby. This measures coverage and internal safety, not whether a designer likes the result; it does not establish that unrelated rooms stay put.
- **Open:** no automated browser suite; no external architectural review; no independent GLB validation in this run; no multi-device GPU measurement; live model, photo and real PDF routes were not exercised in this run. Invalid saved records are skipped safely but cannot yet be recovered. The production build also reports a 1.38 MB minified JavaScript chunk; loading speed needs measurement on slower devices before changing bundling. The original `docs/DESIGN.md` now points to current status because its older rendering and provider plan was superseded.

## Research behind the approach

- [NIST AI RMF Measure guidance](https://airc.nist.gov/airmf-resources/airmf/5-sec-core/) calls for documented, repeatable tests and representative datasets. That supports keeping the brief and measured result together, and recording what a test cannot establish.
- [Playwright browser server setup](https://playwright.dev/docs/test-webserver), [visual comparisons](https://playwright.dev/docs/test-snapshots), and [accessibility testing](https://playwright.dev/docs/accessibility-testing) support a small browser regression suite. Playwright warns that screenshots vary across rendering environments.
- [W3C on accessibility tools](https://www.w3.org/WAI/test-evaluate/tools/selecting/) says automated tools cannot determine accessibility by themselves; manual review remains necessary.
- [Khronos glTF Validator](https://github.khronos.org/glTF-Validator/) provides an independent check for GLB export instead of checking only Icarus's own writer.
