# Icarus submission draft

3 November 2026, replacing the draft of 31 October. For the founder to read and approve before submitting.

The [Meta event page](https://dev.meta.ai/events/global-hackathon) lists the Indie developer track, the "Push the
Frontier" theme and a 4 November 2026, 9 PM ET deadline. Indie entries are judged on creativity, technical ambition and
whether the project works. Check the participant portal and official rules before finalizing fields.

**Live:** https://icarus.dream-studio.workers.dev

## Short description

Icarus turns a written office brief into a measured floor plan and a walkable 3D concept, and changes it when you say
what to change. Muse Spark proposes what the brief left out and reads plain-word edits; a deterministic layout engine
places every room and checks the plan, so the model never draws geometry. "Make it real" path-traces the light of the whole building with Blender
Cycles on a cloud GPU, and you walk anywhere in it in first person.

## The demo path

Brief → Muse Spark proposal → edit by words → walk → Make it real, on the 35-person studio starter.

## Meta models

| Model | Role | Measured |
|---|---|---|
| Muse Spark 1.3 (Meta Model API) | Layout proposals, plan revision, reading free-form edit requests | 20 edit sentences: 20/20 usable answers, 16/16 doable read right, 4/4 impossible flagged, median 9.4 s per request (3 Nov, local Worker, [run5](reference/edit-model-eval/run5-muse-spark-3nov.json)). Design loop over 12 briefs: total plan cost 346.5 against 371.3 without a model, 6.7% lower; better on 4 briefs, worse on 4, level on 4 ([META_CREDITS.md](META_CREDITS.md)). |
| Llama 3.3 70B (Workers AI) | Answers when Muse Spark is refused, busy, down or past the $5 daily cap | Design loop: 361.8 on the same briefs. |
| Llama 4 Scout (Workers AI) | Reading a reference photo into a style | Not evaluated. |

Muse Voice Transcribe (spoken edits), SAM 3.1 (reading plans from images) and a Muse Spark critique of renders were
planned and **are not in the product**.

## Other measured numbers, with their limits

- **Walk room views** on the 35-person studio's rules-only layout: 7 room views (workspace, reception, lounge, kitchen,
  three meeting rooms), each standing on its own room's floor at least 0.3 m from every piece of furniture (unit test).
  The live designs of 4 Nov offered no meeting-room view; the cause is not yet found. Walls cover
  11% to 37% of the frame once the camera settles, by ray casting the 3D view; one reading taken while the camera was
  still moving was 54%.
- **Furnishing:** 35/35 desks, 2/2 phone booths and 18/18 meeting seats placed. The lounge and kitchen cover about 13%
  and 12% of their floor; they have no target to measure against.
- **Make it real:** 240.6 s and 245.0 s from click to walking in baked light on the live site (two runs, cold GPU
  worker); details and limits in [REALISTIC_RENDERING.md](REALISTIC_RENDERING.md).
- **Exports (31 Oct):** a GLB passed the Khronos glTF Validator with zero errors; a DXF passed `ezdxf audit` with zero
  errors.

## Limits to state

- Concept design only: no building-code check, no structural assessment, not a construction document.
- The drawing importer is incomplete: a real residential A3 sheet enclosed 5 of 23 labelled rooms. Drawing edits cover
  straight, identifiable partitions only.
- Rectangular, single-floor offices only in the app. Projects stay in one browser.
- **Independent review:** the walkthrough has not been independently reviewed, and the founder is not independent of
  the work.

## Before submitting

- Founder reads and approves this file and the README.
- Record the demo video on the live site and link it from the homepage and README.
- Check the participant portal's fields and rules.
