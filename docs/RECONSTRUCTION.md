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
