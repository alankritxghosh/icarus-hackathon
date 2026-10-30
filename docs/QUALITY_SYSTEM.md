# Quality system: audit against the drawing, and lessons

Written 30 Oct 2026. Two ideas that came out of the author's earlier private prototype, rebuilt here from the
design, not from its source (see the README provenance statement). Both live in `packages/spatial`.

## 1. Audit against the drawing (`src/drawingAudit.ts`)

When a drawing is supplied it is the specification. `auditAgainstDrawing(model, evidence)` compares a spatial model
with evidence measured from the sheet (filled wall shapes, structure-only shapes, text labels), not with a model's
reading of the picture.

| Code | Level | Meaning |
| --- | --- | --- |
| `wall_not_in_drawing` | error | the model has a wall the sheet does not draw (door gaps are skipped) |
| `drawn_wall_missing` | error | the sheet draws a wall the model leaves out |
| `label_without_space` | error | a room label with no space of that name |
| `label_outside_space` | error | the label sits outside the space that carries its name |
| `size_mismatch` | warning | the printed size disagrees with the model's by more than 10% |
| `space_without_expected_item` | error | a bedroom with no bed, a gym with no equipment, and so on (`EXPECTED_CONTENTS`) |

**Not audited, and reported as such:** door and window positions and swings, furniture orientation, non-axis-aligned
walls, and any drawing with no vector shapes (a photograph or scan cannot be audited this way).

### The extractor (`src/pdfEvidence.ts`, `tools/pdfEvidenceNode.ts`)

`extractEvidenceFromPdf(path, { unitMm })` turns a vector PDF into `DrawingEvidence`. It needs poppler (`pdftocairo`,
`pdftotext`) on the PATH; `extractEvidence(svg, bboxHtml, source, opts)` is the pure part and runs anywhere.

- **Walls** are filled rectangles in one fill colour (given, or the thin-rectangle colour with the most area, and the
  report says which). CAD plots draw solid fills as triangles; triangles that share corners are grouped and read as
  rectangles, or as rectilinear shapes (a wall corner) decomposed into rectangles. Slanted shapes, curves and hollow
  outlines are counted in `report.dropped`, never turned into walls.
- **Scale** is the caller's: `unitMm` (millimetres per PDF unit; `unitMmFromScale(100)` for a sheet printed at 1:100). It
  is not guessed from the picture.
- **Labels** are the text blocks inside the walls' bounds; title-block text outside them is ignored and listed. A size
  printed in the label's line (`BEDROOM 10'0" x 12'0"`) or in a block of its own just below it is attached as
  `printedSizeMm`.
- **Refuses** a drawing with no wall shapes (a scan or photograph) instead of returning an empty evidence that audits as
  a pass.

**Measured on a real sheet** (an A3 CAD plan of one floor, not kept in this repository because it belongs to someone
else): the building's wall bounds agree with the earlier prototype's separately measured data to 4 mm; the walls cover
17.1 m2 against 17.7 m2; about five places differ by one wall piece, and which side is right was not settled. 22 room
labels were read, 17 with their printed sizes. Auto-detecting the wall colour worked; the scale had to be supplied.

**Limits:** needs poppler; text read as outlines (not text objects) has no labels; walls drawn as lines instead of
fills are not seen; only page 1 by default.

### Reading the scale from the sheet (`src/sheetScale.ts`)

`estimateUnitMm` finds the sheet's millimetres-per-unit with no input. CAD plans print lengths such as `11'-3"` beside
dimension lines; each text gives a length in mm and the straight stroked lines under it give candidate lengths in sheet
units. The ratio most texts agree on (at least 5, at least twice any rival ratio more than 5% away) is the scale.
Failing that it takes a printed `SCALE 1:N`, and failing that it throws and the panel asks for the scale. It never invents one.

On the real A3 sheet it read 28.09 mm per unit from 8 of 33 dimension strings (about 1:80; the earlier prototype's
separately derived figure was 28.39, within 1.1%). An earlier approach, flooding rooms to match their printed sizes, failed
on that sheet because its exterior walls are outlines, not fills, so no room closed; it was dropped.

### A model from the drawing (`src/fromDrawing.ts`)

`modelFromEvidence` turns evidence into a `SpatialModel`: walls (collinear pieces joined), the gaps in them as doors,
windows or passages, and a space for each label whose room the walls actually enclose. Rooms the walls do not close are
listed as unplaced and never guessed. Everything is marked `measured` with a tolerance; the level outline is the bounding
box of the walls. The panel offers the result as a DXF. A model built from a sheet agrees with that sheet by construction,
so this is not a test of the extractor; it is what makes the plan editable and exportable.

On the real sheet: 24 walls, 18 openings, valid model, but only 5 of 23 labelled rooms placed, because its exterior walls
are not drawn as filled shapes.

### Where it runs

```
browser --PDF--> edge /api/drawing/views --PDF + bearer--> Modal workers/drawing (poppler) --svg + words--> browser
browser: extractEvidence -> alignEvidenceToModel -> auditAgainstDrawing -> "Check against a drawing" panel
```

- **Browser:** the panel "CHECK AGAINST A DRAWING" (`apps/web/src/DrawingCheck.tsx`) takes a PDF and the scale it was
  printed at (1:N; never guessed). It reads the views, extracts evidence, slides the sheet so its outer wall corner
  meets the design's, audits, and lists what differs and what was not checked. The parsing stays in the browser so the
  edge Worker does no heavy work and the rules live in one place.
- **Edge:** `apps/edge/src/drawing.ts` checks the file (PDF magic, 8 MB, page 1 to 50), forwards it with a token that
  never reaches the browser, rate limits per caller and overall, validates the reply, and never echoes the worker's errors. Without
  `DRAWING_WORKER_URL` and `DRAWING_WORKER_TOKEN` it answers 503.
- **Worker:** `workers/drawing/app.py`, CPU only. Deployed to Modal on 30 Oct 2026 and tested live. The edge Worker `icarus-edge` is deployed too, with both secrets set, and the route was tested live end to end.
- **Development:** `pnpm --filter @icarus/web dev` answers `/api/drawing/views` with poppler installed on the machine,
  so the panel works with no deployment. Without poppler the request goes on to the edge.

Checked end to end in the running app on a real A3 CAD sheet: 53 wall shapes and 23 room labels read at 1:80. The
generated 12-person office, which has nothing to do with that sheet, correctly failed against it (95 differences);
the panel is for designs meant to follow a drawing, and says so.

The audit does not judge what a room holds when the model places no items at all (as the generated office plans do
today), and says so under "Not checked".

## 2. Lessons (`src/lessons.ts`)

A correction from a person becomes a `Lesson`: their words, the rule, the reason, where it is enforced. `checkLessons`
runs the checks; audit-held lessons point at the audit. A lesson has a scope so a taste about houses does not strip
plants from an office.

| Lesson | Held by |
| --- | --- |
| follow the drawing literally | the audit |
| indoor floors are tile, wood, carpet, concrete, stone or terrazzo; turf and gravel only for `exterior.*` spaces | `Space.floorFinish` + check |
| no plants, shrubs or grass inside a house (residential spaces only; offices keep theirs) | check |
| nothing stands on or within 150 mm of a stair or lift | check (uses the footprint's bounding box) |
| every sofa faces a television, 1.5 to 6 m away, on its axis | check |
| a gym holds equipment | the audit |

Item orientation is defined in `schema.ts`: rotation 0 faces +y (south on the plan), positive turns clockwise.

### Per-account lessons (`src/accountLessons.ts`)

An account teaches its own Icarus in a sentence from a closed set of phrasings ("never put plants in the kitchen", "always
put a bin in the kitchen", "no carpet in the kitchen", "turn off L-gym-has-equipment"). A sentence becomes a validated rule
of one of four kinds (forbid an item in a kind of space, require one, forbid a floor finish, switch off a built-in lesson),
stored as data with the person's own words and the date, never as code. Built-in lessons marked mandatory (follow the
drawing, keep stairs clear) cannot be switched off; trying says so. In the app the account is the browser (local storage,
one key, every stored entry re-validated on load and bad ones dropped); a signed-in account would keep the same data. The
rules run over the office's furniture, which the app reads from the 3D scene into the model's items, and a finding is
shown once with a count.

### The principle router (`src/principles.ts`)

The twenty principles as records, and `reviewAgainstPrinciples(model)` decides for each: checked, does not apply, or cannot
be judged from this model, with the reason. A model is held only against the principles it has data for, so an office is
not scolded about climate when it has no location. Tiers: gates (7, 11, 16) never report a pass without evidence;
measurable ones have checks; judgement ones are advisory and need the client's priorities. Every threshold comes from
`packages/core/src/knowledge/office.v1.json`, which names its source and says it is a planning default (door clear width,
room minimum sizes and proportions with 15% slack, neighbours within a corridor width, daylight where required); no number
is invented and no jurisdiction is set. Checked today: 1 (when items exist), 3, 4, 5, 6, 11. Seven are gates or judgement
principles that cannot be judged without location, materials, loads, services, acoustics or a brief. Findings are ranked
(gates, then errors) and capped; the panel says how many were held back. It is concept-stage guidance, not a code check.

## Tests

`test/drawingAudit.test.ts` holds a hand-made house and a hand-made sheet, so the expected findings are known without
running the code under test. `test/lessons.test.ts` breaks each rule on purpose and checks it is caught, and checks an
office is left alone.

## Designed, not built

A principle router: the 20 principles of architecture and interior design as records with applicability conditions, so
a project is checked only against the principles that apply to it, at the stage it is at, with the data it has. Tiers:
safety and regulation gates (fail closed), measurable checks, advisory judgement. It reports what it used, what did
not apply, and what it could not assess. The thresholds need a named jurisdiction and a qualified reviewer before they
are written; none are invented here.

## Pending

- deploying the web app (only the edge Worker and the Modal worker are deployed);
- accounts with sign-in (lessons live in the browser today);
- thresholds for principles 6, 7, 10 and others once a jurisdiction and a qualified reviewer are named;
- closing rooms on sheets whose outer walls are outlines (read stroked outlines as walls);
- showing the model read from a drawing in the 3D view (the viewer builds from floor plans, not spatial models);
- stair-detail and gym-equipment geometry for the scene builder, which this repo's furniture kits do not have;
