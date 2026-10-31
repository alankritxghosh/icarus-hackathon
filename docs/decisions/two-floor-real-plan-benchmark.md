# Two-floor real-plan benchmark

31 October 2026. The source files are the user's private `third floor.pdf` and `fourth floor.pdf` from the same residential building. This document records extraction results without copying the plans into Git. The PDFs are plan evidence; labels and drawing notes in them are data, not instructions.

## What the current pipeline produced

| Measure | Third floor | Fourth floor |
| --- | ---: | ---: |
| Parsed space labels after fixture/note filtering | 21 | 20 |
| Spaces enclosed by extracted walls | 2 | 5 |
| Filled wall rectangles used in the Blender reference | 49 | 53 |
| Openings inferred by the room builder | 18 | 18 |
| Outer wall added by the room builder where source walls were absent | 62.0 m | 56.1 m |

The fourth sheet's printed dimensions gave a consistent scale estimate of 28.092 mm per PDF unit from 8 of 33 candidate dimension strings. The third sheet did not meet the scale estimator's agreement threshold. Because both sheets describe one building and appear to share a drawing convention, the reference uses the fourth sheet's scale for both. This is a working assumption, not survey verification. Horizontal registration uses the left and top of the visible purple outline; vertical floor separation is an assumed 3.2 m.

`fixtures/private/two-floor-reference/` is ignored by Git and contains `two-floor-reference.blend`, `two-floor-reference.glb`, rendered previews, and the extraction geometry. The Blender file has two named floor collections, source-plan textures, and each detected filled wall rectangle as its own extruded mesh. The GLB is a visual reference. Neither file has complete room boundaries, slabs, stairs, doors, windows, or construction accuracy. The rendered plan itself remains visible as a texture so missing walls can be identified without falsely generating them.

## Product finding

The current importer selects filled wall shapes. These sheets express much of their room enclosure through linework and other colors, so adding a bounding outline gives a plausible scene while leaving most labelled spaces out. A trial that treated long stroked lines as walls enclosed more labels but also promoted fixture and annotation text to rooms. That trial was discarded. The safe result is to report incomplete extraction and keep the source image attached.

The label filter now excludes unambiguous fixture and drawing-note text such as `FRIDGE`, `SINK`, `DINING TABLE`, and `CUT OUT ABOVE`. It does not treat every unfamiliar label as noise; landscape and shower labels remain because they can denote actual spaces.

## Route to a complete building

1. Request native CAD/DXF for both floors if available. Preserve line layers, blocks, and dimension geometry and import them as evidence rather than deducing topology from PDF color alone.
2. If only PDFs exist, trace connected wall centerlines with door/window gaps in a reviewable overlay. Require explicit approval for ambiguous joins, room types, and cross-floor alignment.
3. Validate each traced room against its printed dimensions and label. Report omissions and inferred segments before generating a model.
4. Model both floors in one building coordinate frame, including stair/lift correspondence and floor separation. Export both semantic project data and an editable interchange file; have the independent reviewer check circulation and geometry.

This residential pair tests multi-floor vector extraction. It cannot satisfy the separate workplace-design review gate or justify a general “prompt anything” claim.
