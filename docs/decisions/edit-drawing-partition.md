# Edit a partition in a drawing-derived plan

31 October 2026. First slice on `codex/editable-drawing-demo` for the founder to review; this is not a claim that arbitrary drawn rooms can be edited.

## Decision

For an explicit request such as “move the wall between kitchen and office 0.5 m toward office,” move the filled wall shapes in the working drawing evidence, then reconstruct the spatial model and 3D scene. Save the evidence and model together as one revision. Undo restores both. No extra UI control is needed.

This supports only one uniquely identified, straight interior partition between two enclosed, named rooms. The room labels must stay clear of the moved wall. Refuse a change if another room, wall or opening changes unexpectedly. The original evidence is retained in the saved project. Changed geometry is marked generated; the edit does not imply that the wall is nonstructural.

## Alternatives

- Moving the rendered wall mesh would leave the plan, doors and room floors behind. Rejected.
- Editing room polygons directly would have to reconcile wall thickness, door gaps and the grid-derived room boundaries; a two-room drawing produced many small steps around the door. Rejected for this slice.
- Re-reading amended wall rectangles uses the existing importer and scene generator. Chosen for a small, reviewable vertical slice. It is slower than a direct boundary edit and still inherits the importer's limits.

## Experiment and limits

A hand-specified 6 × 4 m two-room plan with a 1 m doorway was moved 500 mm. The tests checked the wall coordinate independently (3000 → 3500 mm), preserved the doorway and shell, compared room widths, and validated the rebuilt model with Clipper2. A browser demo imported a generated vector PDF at 1:100, moved the partition in Plan, reloaded and reopened the project, then undid the move. An edited DXF downloaded from the browser passed `ezdxf audit` with no errors. Screenshots are `/tmp/icarus-editable-before.png`, `/tmp/icarus-editable-after.png` and `/tmp/icarus-editable-undone.png` on the test machine.

The test drawing is simple and made by this repo. Real drawings may use stroked walls, irregular boundaries, junctions, multiple levels and structural walls; this edit refuses ambiguity. Furnishing is regenerated after a wall move. If a room becomes too narrow for furniture, the reply says so; the user can undo. A real architect has not evaluated whether the changed rooms are useful. Broaden the editor only after representative plan tests show each new geometry operation leaves unrelated evidence unchanged.

A second measured three-room fixture now exercises two distinct straight partitions in sequence: kitchen/office moves 300 mm, then office/meeting moves 300 mm. Exact source rectangles move, the exterior shapes and unaffected third-room boundary remain identical, openings remain present, and the rebuilt model validates. This extends the bounded operation to two sequential edits on simple filled-wall evidence; it does not establish reliability on a second real PDF or on junctions.
