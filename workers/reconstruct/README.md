# Reconstruction worker (Modal)

Measures a single photograph: a metric point cloud and the camera field of view (MoGe-2, MIT).
It owns no scene state; `packages/core` decides what the numbers mean.

```bash
.venv/bin/modal run app.py --image ../../apps/web/public/references/c4di-coworking.jpg
```

Weights are cached in the `icarus-weights` Modal volume. GPU time is billed per second against the
workspace's credits; `max_containers=1` and a 60 s scale-down keep a stray call cheap.
