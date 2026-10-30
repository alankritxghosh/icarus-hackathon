# Make it real: the model itself, rendered on the viewer's GPU

30 Oct 2026. "Make it real" used to send a snapshot to an image model and show a static picture. It now renders the live 3D
model with progressive GPU path tracing in the browser: orbit and walk it while it sharpens; export it to Blender as it
is. No image is generated and no server GPU is used.

## What it is

`apps/web/src/officeView.ts` (`setRealistic`) hands the scene to `three-gpu-pathtracer` 0.0.27 (MIT; peer `three-mesh-bvh`
0.9.17), which traces light paths on the viewer's GPU: global illumination, soft shadows, light through the windows
from a photographed high-dynamic-range sky (Poly Haven Alps Field, 2k, CC0; a drawn sky stands in until it loads), ceiling lights as area lights, the CC0 models with their own materials.

- The BVH of the building is built in a web worker, so the page stays usable while it is prepared.
- While the camera moves it shows a quick low-resolution pass; the full image accumulates when it stops.
- An edge-aware blur on the accumulated image, shaped by the sample count, hides grain early and fades as samples arrive.
- It starts at 0.6 of screen resolution and shrinks to 0.4 if fewer than 3 samples a second arrive (not while the page is
  hidden, when the browser slows animation).
- It stops at 600 samples so the GPU is left alone; any movement restarts it.
- Without WebGL2 float rendering it says so and stays on the quick view. Nothing about samples or progress is shown to the person.

## Why this and not the alternatives

| Option | Verdict |
| --- | --- |
| Server GPU stills (the old image-model repaint) | A picture, not a model; cost per click; invents details the model does not have. Rejected by the founder's brief. |
| Cycles on a Modal GPU, sent back as images | Photographic and exact, but static and metered per view. Kept as a possible export, not the interactive path. |
| Rasterised PBR with ambient occlusion and shadow maps | Interactive on any GPU, but no real bounced light; interiors look flat. The preview already is this. |
| **Path tracing in the browser** | Real global illumination on the live, interactive model, at no server cost. Cost: heavy on weak GPUs. |

## Measured, with its limits

One machine: an Apple M1 in the desktop app's embedded browser, a 12-person office of 8 rooms:
628,000 triangles (the CC0 furniture dominates), 8 ceiling area lights, 1000 x 850 canvas.

- Orbit view at 0.5 resolution: about 10 samples a second, 100 samples in 11 s, 160 in 22 s. A clean, soft image.
- Walk view at 0.55 resolution: about 1 sample a second (29 in 30 s). Usable, still grainy.
- At 0.8 resolution an early run managed about 0.7 samples a second: too slow, which is why it starts smaller.
- Measured by driving the tracer directly, because the embedded page was reported hidden and throttled its animation frames,
  so the live frame loop was not timed. A visible window will do at least as well.

So on a base M1 the first usable image takes seconds and a clean one under a minute; a discrete GPU should be several times
faster. This has not been measured on any other machine. Heavy furniture models are the largest cost; lighter ones would help.

## Not done

- Nothing was compared against a photograph, so "exactly like real life" is the aim, not a measured result.
- The materials are plain colours and canvas wood; there are no PBR texture maps, so surfaces look clean, not worn.
- Furniture other than the nine CC0 models is built from boxes and looks like it.
- No denoiser beyond the blur above; at low sample counts grain remains in shadows.
