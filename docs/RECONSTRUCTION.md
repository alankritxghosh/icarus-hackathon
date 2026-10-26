# Photo reconstruction: measured results

Goal: rebuild the visible part of a photographed room as an Icarus scene. This file records what each
stage measurably achieves, so claims stay tied to numbers.

## Method (stage 1: room geometry)

`workers/reconstruct` (Modal, L4 GPU) runs MoGe-2 (MIT) on a photo and returns a metric point cloud and
the horizontal field of view. `packages/core/src/reconstruct` fits the floor, ceiling and vertical walls
by RANSAC (deterministic), weighting evidence by the surface each point stands for and suppressing
duplicates. Inference takes about 1.5 s on the GPU.

## Accuracy against known truth (27 Oct 2026)

The only ground truth available is Icarus's own scene, so the test is an eye-level render of the demo
office (camera at 1.6 m, ceiling 2.9 m, workspace walls at known distances). A render is easier than a
photograph in some ways (clean surfaces) and harder in others (no texture, so depth is less certain).

| Quantity | Measured | Truth | Error |
| --- | --- | --- | --- |
| Field of view (horizontal) | 79.7 deg | 78.8 deg | +0.9 deg |
| Camera height | 1.37 m | 1.60 m | -15% |
| Ceiling height | 2.71 m | 2.90 m | -7% |
| North wall (close) | 0.86 m | 1.20 m | -0.34 m, -28% |
| South wall | 7.52 m | 8.40 m | -0.88 m, -10% |
| East wall (far) | 13.58 m | 16.80 m | -3.22 m, -19% |
| West wall | not found | behind the camera | cannot be seen |

Also found: one false wall (1.37 m, 1069 points) from clutter. All distances are underestimated, so the
metric scale of this model is biased low by roughly 7 to 20% on this input.

## Real photo (no truth available)

Glass-front coworking photo (CC BY 4.0): camera height 1.51 m, ceiling 2.70 m, left wall 3.19 m, right
(glass) wall 2.44 m, a far wall at 14.84 m. These are plausible, and unverified.

## Known limits

- Anything behind the camera, or hidden, is not reconstructed.
- Glass and mirrors break depth; far surfaces (beyond about 15 m) are unreliable.
- Scale error of 10 to 20% is a real feature of this method on this evidence.
- One photo gives no information about what is out of frame.

## Benchmark (27 Oct 2026, later the same day)

One test view was too thin a basis, so there is now a benchmark: 16 eye-level renders from three of
Icarus's own offices (a 24 x 16 m studio, a 14 x 10 m startup, a 22 x 14 m consultancy), taken at the
viewpoints the product picks, each at 1024 x 576 (the size the repaint uses). The truth (camera, ceiling,
room rectangle) comes from the plan. `packages/core/test/bench` scores them; it runs only when
`BENCH_DIR` points at a folder with `truth.json` and the worker's `geo/bench-<office>-<view>.json`
outputs (made with `modal run app.py --dir ... --out-dir ...`), so a fresh clone still passes. The
inputs are renders, which are cleaner than photographs and have no texture; treat the numbers as
indicative of the method, not of photos. Truth and results: `docs/reference/reconstruction-bench/`.

| Measure (56 lengths over 16 views) | Median error | Median signed |
| --- | --- | --- |
| Overall | 12.4% | -11.1% (too short) |
| Camera height (14) | 15.4% | -20.9% |
| Ceiling height (12) | 13.1% | -13.4% |
| Wall distances (30) | 11.1% | -9.3% |
| **After scaling the ceiling to a typical 2.8 m** | **5.5%** | -3.4% |

Also: 2 of 16 views had no fit (the lobby), 6 false walls, 7 walls missed (some are not visible), and 3
of 16 field-of-view estimates were far off (about 52 and 79 degrees against a true 105) while 13 were within
about 12 degrees.

### What the benchmark found and what changed

1. **Floors.** In meeting rooms the largest flat plane was the table top, hiding the real floor (camera
   height 0.65 m against 1.6 m). The bottoms of the walls now give the real floor level; the correction
   applied in the three meeting-room views and moved camera height to 0.95 to 1.13 m, still short.
2. **Scale.** The depth model shrinks small rooms most (reception: ceiling 2.04 m against 2.9 m). A typical
   ceiling is far less variable than that error, so `calibrateRoom` scales the room to a 2.8 m ceiling and
   reports it as an assumption with a 15% bound (real ceilings run about 2.4 to 3.4 m). The 5.5% figure
   is flattered because every benchmark office has a 2.9 m ceiling; for real rooms the honest bound is
   the 15%.
3. **Walls.** Evidence is weighted by the surface a point stands for, duplicates are merged, and walls
   must be square to the dominant axes, which removed the false diagonal.

### Still wrong

False walls (6), the lobby gives no fit, three field-of-view estimates are far off, and camera height
is still the worst measure (about -21% median before calibration). No objects are reconstructed yet.
