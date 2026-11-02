# Make it real: the model rendered with Cycles on a Modal GPU

3 Nov 2026. "Make it real" renders the view on screen with Blender Cycles on a Modal GPU and shows the picture over the
live model. It replaces the browser path tracer of 30 Oct, which the founder found slow and weak on his laptop: it used
the viewer's own GPU, and Modal played no part.

## What it is

1. `apps/web/src/Studio.tsx` (`makeReal`) asks the 3D view for its camera and sun (`OfficeView.renderView`) and for the
   model as a GLB with only what is on screen (`exportGlb(plain, true)`: no hidden roof or upper floor, and no wall the
   walk camera has faded to see past). It posts both to `/api/render`.
2. `apps/edge/src/render.ts` limits each caller to 4 renders a minute and everyone to 30, checks the view and that the
   body is a GLB of at most 60 MB, and forwards both with a bearer token the browser never sees. It checks the reply's
   shape before passing the picture back.
3. `workers/render/app.py` (Modal app `icarus-render`) imports the GLB into Blender 4.2 (`bpy`), places the same camera,
   adds a matte paper ground, a physical sky (its own sun disc off) and a sun from the browser's sun direction, and
   renders 128 samples with Cycles on the GPU (OptiX), denoised with OpenImageDenoise, in AgX. It adds nothing to the
   model.

The picture is a still of one view, not a walkable scene. The quick 3D view stays in the browser for moving around.

## Why this and not the alternatives

| Option | Verdict |
|---|---|
| Path tracing in the browser (30 Oct to 2 Nov) | Real bounced light on the live model at no server cost, but as slow as the viewer's GPU: about 1 sample a second walking on an M1, on an 8-room office. The two-floor plan is about a million triangles. Removed with its two packages and sky image. |
| Image-model repaint of a snapshot | A picture, not the model; invents details the model does not have. Rejected earlier by the founder. |
| **Cycles on a Modal GPU** | The same model and camera, path traced on a data-centre GPU in seconds, and the same on a phone as on a desktop. Paid per second and static. Chosen. |

## Measured, with its limits

2 to 3 Nov 2026, the private two-floor plan (42 spaces), a 3.3 MB GLB without textures:

- **GPU supply.** With only L4 allowed, a render waited over 400 s for capacity and never started. The worker now takes
  the first free of L4, A10G or L40S; which one served each run was not recorded.
- **Warm worker:** 3.6 to 7.1 s of Cycles rendering at 960 × 600 to 1280 × 800, 1.5 to 1.9 s to import the model, and 8
  to 16 s from button to picture in the app, including the export and the upload.
- **Cold start** was not measured cleanly: the first calls after deploys failed on the OptiX denoiser (fixed by using
  OpenImageDenoise) or reached a crashed container.
- **Light** was set by eye over seven renders of the same view (sun 2.6, sky 0.4 with no sun disc, exposure -1.1). It
  has not been compared with a photograph or judged by a designer.
- **Cost:** about 10 to 20 s of GPU time per render, roughly 0.3 to 1 US cent at Modal's list prices for these GPUs. The
  worker scales to zero after 2 minutes idle.

## Not done

- The deployed edge Worker on workers.dev does not have this route or its two secrets yet: the Cloudflare login on this
  machine expired. Until it is redeployed, Make it real works only with the local Worker.
- Multi-floor projects export plain colours (`plainExport`), so their renders have no textures.
- The worker returns 500 for a Cycles failure; the app shows it as "the renderer failed" without the cause.
