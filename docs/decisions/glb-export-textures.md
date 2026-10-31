# Limit GLB texture size for concept handoff

31 October 2026. The GLB is a visual concept scene for Blender, not an editable CAD model.

## Decision

Export embedded textures at a maximum of 512 px on a side. Keep the in-app 1k textures and geometry unchanged.

## Alternatives

- Keep all export textures at their source size: no new code, but the recovered 12-person office exported at 121 MB. Repeated image payloads accounted for about 84 MB, so download and sharing are needlessly heavy.
- Deduplicate identical image payloads in the GLB: could preserve source resolution, but requires a binary post-processor or more invasive exporter changes and a stronger validation burden. This remains a possible later improvement.
- Limit textures only in the exporter's existing `maxTextureSize` option: one reversible option and no new dependency. Detail on close-up furniture and materials is reduced in the exported file.

## Experiment

From the same recovered 16.5 × 11.5 m office in a local browser, the original GLB was 126,948,916 bytes (121 MiB). After reloading the viewer with `maxTextureSize: 512`, the GLB was 39,238,712 bytes (37 MiB), about 69% smaller. Both imported in Blender 5.2.1 with 214 meshes, 579 objects, 70 materials, 86 images and 231,865 vertices. The smaller GLB's embedded PNGs were at most 512 × 512. The browser-exported DXF separately passed `ezdxf audit` with zero errors and 67 entities; its extents matched the recovered shell plus wall thickness.

## Limits and reversal

The Blender import proves readability and matching geometry counts, not identical visual quality or editability. Close-up texture quality was not compared. Revisit this cap if a customer needs higher-resolution materials or an image-deduplication pass proves small and reliable. The prior Khronos validator run on a different office found tangent-space warnings; this exact file has not yet been run through that validator.
