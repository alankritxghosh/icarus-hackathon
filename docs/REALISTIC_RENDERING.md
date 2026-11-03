# Make it real: the whole building lit by path tracing, then walked

4 Nov 2026. "Make it real" path-traces the light of the whole building with Blender Cycles on a Modal GPU and dresses
the live model in it, so the visitor walks anywhere, in first person and in real time, under that light. It replaces
the single still picture of 3 Nov: the founder wanted the whole project to become real and roamable, not one image.

## What it is

1. `apps/web/src/officeView.ts` (`exportForLight`) gives every floor, wall, ceiling, door and frame light-map
   coordinates (`apps/web/src/lightmap.ts`: the six faces of each box on one square texture, 4 texels apart, about 28
   texels a metre, at most 1024 px) and exports the whole building as a GLB, the coordinates as `TEXCOORD_1` and each
   texture size in the node's extras.
2. `apps/edge/src/render.ts` limits each caller to 4 bakes a minute and everyone to 30, checks the view and the file,
   and starts the bake with a token the browser never sees. A bake takes minutes, longer than one web request may wait
   on Modal (about 150 s), so POST answers at once with a job id and the browser asks `GET /api/render?job=...` every
   3 s. Asking is not rate limited; job ids are checked before they reach the worker.
3. `workers/render/app.py` (Modal app `icarus-render`, bpy 5.2.3) imports the GLB, lights it with a physical sky, a
   sun from the browser's direction and the model's own light fittings (bright emissive surfaces at about 4000 K and
   strength 30, so a downlight disc lights its room), makes glass clear, and bakes diffuse light only (direct and
   indirect, no colour) into one image per surface. Each image goes through Intel Open Image Denoise in Blender's
   compositor, on the CPU. Exposure is set so the geometric mean of all baked light is 1. The bake runs in a watched
   child process: a Blender crash is reported in seconds instead of leaving the browser waiting.
4. Back in the browser (`wearLight`), each surface keeps its own colour and texture and multiplies in its light map,
   unlit, so what shows is the path-traced light. Painted walls and ceilings drop the plaster scan, whose mottling reads
   as grime under real light. Walk turns first person under the ceiling, with no avatar and nothing faded, and exposure
   adapts from room to room: twice a second the view meters a 48 x 30 linear copy of the frame and eases toward mid
   grey, within two stops.

Furniture is not baked: it keeps the live model's lighting, so it reads a little less real than the room around it.

## Why this and not the alternatives

| Option | Verdict |
|---|---|
| One path-traced still of the view (3 Nov) | Photographic, but one picture: you cannot walk it. Replaced. |
| 360 degree panoramas at each room view | Photographic and cheap, but you hop between fixed points. Offered on 4 Nov; the founder chose free walking. |
| Path tracing in the browser (30 Oct to 2 Nov) | As slow as the viewer's GPU: about 1 sample a second on an M1. Removed earlier. |
| **Light baked on a GPU, walked live** | The building's own light, walkable anywhere at browser frame rates. The light is static: an edit needs a new bake. Chosen. |

## Measured, with its limits

The 35-person studio starter: 171 surfaces, a 24.5 MB GLB, 128 samples.

- **Live, button to walking:** 240.6 s and 245.0 s on 4 Nov, both on a cold GPU worker: exporting, uploading, the
  worker starting, the bake, denoising and loading the maps. Which GPU served each run was not recorded. A run between
  them aborted in the denoiser (Blender 5 reached for EGL); the compositor now runs on the CPU, and the 245 s run came
  after that fix.
- **Light maps:** 171 JPEGs, about 0.8 MB in all.
- **Denoiser,** against a known image (a gradient under heavy multiplicative noise): RMS error 0.639 before, 0.045
  after, on Blender 4.2 and 5.2 alike.
- **Light-map layout:** a unit test checks every face of walls, slabs, doors and frames stays inside its texture, at
  least 2 texels from the next, and in proportion.
- **On the founder's M1 (Metal),** the same bake took 4 to 7 minutes at 64 to 128 samples; one run read 96 minutes,
  most likely while the machine slept, so it is not a measurement.
- **Look:** judged by eye in screenshots of the workspace, lounge, kitchen and reception. It has not been compared with
  photographs or judged by a designer.

## Faults found on the way (4 Nov)

- Blender 4.2 crashed while loading textures for a bake, on Modal and on a Mac, and the process pool then waited
  forever. Moved to bpy 5.2.3 and a watched child.
- The browser export wrote one flipped copy of a normal map per wall: 64 MB of images where 13 MB were distinct.
  Flipping each image once cut the studio's GLB from 75 MB to 24 MB.
- Walking in an office hid every wall after the first step: office floor ids start with "floor.", which Walk took for
  the name of a storey. Fixed.
- Clearing the walk camera's faded walls after the light went on undid the light on six walls. Fixed.

## Not done

- Furniture is lit live, not baked.
- An edit or a new design needs a new bake; the light is not updated in place.
- Multi-floor projects from drawings have not been baked.
- Warm-worker bake time, and time across GPU types, are not yet measured.
