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

**Not built yet:** the extractor that turns a vector PDF into `DrawingEvidence`. The prototype had one; it has to be
rewritten here before an uploaded sheet can be audited.

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

- the vector-PDF evidence extractor;
- per-account lessons (the prototype taught each account its own rules);
- stair-detail and gym-equipment geometry for the scene builder, which this repo's furniture kits do not have;
- the principle router.
