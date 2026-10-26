# Reference targets

`coworking-warm-oak-green.jpg` is a **quality target, not Icarus output**. It was generated from a text
prompt by `@cf/black-forest-labs/flux-1-schnell` on Cloudflare Workers AI (free tier) on 26 Oct 2026, to
show the photographic bar the "Make it real" step aims at. Prompt: "photograph of a bright modern
coworking office, warm oak floor, green plants, floor to ceiling windows, soft daylight", 4 steps.

Nothing in the product may present a picture like this as a faithful render of a plan unless it has been
checked against that plan.

`make-it-real-first-run.jpg` is the first real "Make it real" run: a snapshot of the 3D office (`apps/web`,
27 Oct 2026) repainted by `@cf/black-forest-labs/flux-2-klein-4b` through `apps/edge` on Cloudflare's free tier
(13 s, seed 7). It keeps the layout, rooms, desk rows, chairs and windows but treats the dark margin
around the model as a large room, so it reads as a photographed scale model. The fix is an eye-level
interior camera, not a better prompt. This is generated and illustrative: it has not been checked
against the plan.

`make-it-real-eye-level.png` is the same pipeline from an eye-level viewpoint ("Open workspace"), run from the
app's Make it real button through the Worker (flux-2-klein-4b, free tier, about 15 s). The reference snapshot
was the live scene at 1024 x 576. It reads as an interior photograph and keeps the row layout, the door,
the windows, the green chairs and the plants. It is generated and illustrative: details such as monitors,
extra plants and the ceiling panel are the model's, and it has not been checked against the plan.
