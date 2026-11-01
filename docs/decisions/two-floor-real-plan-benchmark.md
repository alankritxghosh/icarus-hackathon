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

Icarus now accepts both PDFs in one attachment, uses the scale inferred from the fourth sheet for both, and saves one project with two level records. Its renderer stacks the partial geometry at a stated 3.2 m interval and shows inferred outer walls translucently. A fresh browser import saved 7 enclosed spaces, 66 modeled wall runs and 36 inferred openings. This is an in-product partial reconstruction; the external Blender reference above remains a separate inspection aid.

The browser exported the combined project as GLB. The default textured export was 232 MB for this scene; using plain materials for combined PDF projects reduced it to 1.35 MB while retaining the meshes. The Khronos glTF validator reported zero errors and zero warnings on the smaller file. The local browser screenshot and GLB are kept in ignored `fixtures/private/two-floor-reference/`.

## Product finding

The current importer selects filled wall shapes. These sheets express much of their room enclosure through linework and other colors, so adding a bounding outline gives a plausible scene while leaving most labelled spaces out. A trial that treated long stroked lines as walls enclosed more labels but also promoted fixture and annotation text to rooms. That trial was discarded. The safe result is to report incomplete extraction and keep the source image attached.

The label filter now excludes unambiguous fixture and drawing-note text such as `FRIDGE`, `SINK`, `DINING TABLE`, and `CUT OUT ABOVE`. It does not treat every unfamiliar label as noise; landscape and shower labels remain because they can denote actual spaces.

## Route to a complete building

### 1 November route evidence check

The founder authorized using the visible stair edges as a **concept-stage alignment assumption** while CAD or dimensioned stair evidence is unavailable. On the third sheet, the route starts at the labelled east entrance, passes through the lobby door into the foyer, then crosses the labelled transition space to the upper-middle stair marked UP. On the fourth sheet, the corresponding upper-middle stair meets a labelled transition space. Bedroom 2 is a candidate first destination through the walk-in wardrobe; its intervening door positions still need tracing. The drawings, not room adjacency, are the source for these route features.

The saved reviewed project does not yet contain the third-floor transition space, either stair footprint, a stair connector, a floor void, or source-located route doors. Its room-trace doorway records are estimated. Comparing the visible upper-middle stair edges with the saved room coordinates indicates about **2.2 m of horizontal disagreement** between the two levels' current registration. This is a screen/trace comparison, not a surveyed measurement. The fourth-floor scale transfer, registration and 3.2 m floor interval remain assumptions. The stair's total rise, tread run and landings are not established by a printed stair section in these sheets. These facts block a truthful physical stair route in the current model.

The spatial layer now accepts a source-referenced opening to replace an adjacency-guessed gap on its host wall. A generated two-room fixture checks that the guessed gap closes, the reviewed gap opens in the scene, and the evidence reference survives in the model. This is a geometry primitive, not a claim that the private route doors have been verified. The next geometry step is to trace and review the missing transition and stair footprints, register the levels at the stair, then place paired openings on both sides of each route wall before adding a stair flight and slab opening.

**Decision, 1 November:** Keep the existing spatial wall/opening representation and replace guessed openings one reviewed host wall at a time. The alternatives were (a) continuing to infer all gaps from adjacent room rectangles, which cannot establish door positions, and (b) placing an independent game collision map, which would let Walk disagree with the model and export. The generated two-room fixture moves a gap away from the adjacency midpoint and verifies the scene wall pieces at both positions; it also rejects an opening without a source reference. This approach uses no new dependency and keeps the gap in the model that drives rendering. It will need revision if the source requires curved or junction-spanning openings. The fixture is synthetic, so it does not validate any door on the private sheets.

1. Request native CAD/DXF for both floors if available. Preserve line layers, blocks, and dimension geometry and import them as evidence rather than deducing topology from PDF color alone.
2. If only PDFs exist, trace connected wall centerlines with door/window gaps in a reviewable overlay. Require explicit approval for ambiguous joins, room types, and cross-floor alignment.
3. Validate each traced room against its printed dimensions and label. Report omissions and inferred segments before generating a model.
4. Model both floors in one building coordinate frame, including stair/lift correspondence and floor separation. Export both semantic project data and an editable interchange file; have the independent reviewer check circulation and geometry.

This residential pair tests multi-floor vector extraction. It cannot satisfy the separate workplace-design review gate or justify a general “prompt anything” claim.

## In-app plan review experiment (1 November)

The local Icarus worktree now renders the actual first PDF page in Plan view. A person draws a rectangle around a space; Icarus takes its printed name when available, or asks for a short name when PDF text misses it. That outline becomes a room floor and estimated wall edges in the two-level spatial model. The plan overlay stays visible so misplaced outlines can be checked and undone. The model uses the installed CC0 Poly Haven furniture and PBR floor/wall materials where a matching room type exists. It can be saved as an `.icarus.json` project and reopened by attaching that file in the composer.

Using this workflow in headless Chrome, the two supplied PDFs produced 36 reviewed outlines (19 on the third floor, 17 on the fourth), including a fourth-floor balcony whose printed name was not extracted. The saved file is ignored at `fixtures/private/two-floor-reference/icarus-reviewed.icarus.json`; screenshots of Plan and 3D are beside it. Reopening the file and adding the balcony produced no page errors. These are manually drawn rectangles, so their edges are approximations. They do not encode the source's irregular wall joins, doorway/window geometry, stairs, vertical voids, or furniture layout. The 3D building is therefore a navigable rough massing model, while Plan view remains the faithful source reference. Printed room dimensions, the shared scale, and floor alignment need independent checks before use as a design or construction model.

## Playable visit experiment (1 November)

The two provided sheets are the third and fourth floors; no ground-floor plan was supplied. Walk now starts a visible third-person avatar at the third-floor lobby, facing the east entrance into the foyer. Holding WASD/arrow keys or the on-screen pad moves the avatar; dragging turns the follow camera. Walk cuts away the upper floor and ceilings for a clear view of the lower level, and floor buttons relocate the avatar to the chosen level. The 3D overview shows flat roof/ceiling slabs over indoor spaces and has a Roof toggle. Export includes the full model even when Walk hides one level for viewing.

Adjacency between reviewed rectangles generates estimated passage gaps for traversal. A local model check found 36 spaces, 96 traced walls, 64 opening records (paired wall gaps), 15 upper roof slabs, 28 ceiling slabs, and 42 CC0 asset nodes; exactly one opening is flagged as the foyer/lobby entrance. These gaps and roof patches are a playable visual approximation, not a reconstruction of the drawn door swings, roof structure, stairs or building code. Moving between supplied floors uses an explicit UI relocation because the aligned stair geometry is not yet verified.

In the local browser, Walk spawned the avatar at the east entrance; holding W moved it into the foyer, and the on-screen forward pad moved it as well. The fourth-floor button relocated the avatar to the upper landing, the third-floor button returned it, and the roof toggle changed the 3D overview. A GLB exported while Walk cut away the upper level still contained both level node groups (167 L3 and 230 L4 nodes) and roof nodes. The browser screenshot is kept privately as `icarus-walk-entrance.png`. This confirms interaction in one browser session, not collision and visibility across every room or device.
