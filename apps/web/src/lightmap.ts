/** Light-map texels per metre of surface, before a big surface is capped at 1024 px. */
const TEXELS_PER_M = 28;
/** Texels kept empty around each face, so light from one face never bleeds into the next. */
const PAD = 4;

/**
 * Light-map coordinates for a box: its six faces laid out on one square texture with a few texels between them, so
 * no two faces share light. Returns one coordinate pair per vertex, in three.js BoxGeometry's face order (+x, -x, +y,
 * -y, +z, -z; corners (0,1) (1,1) (0,0) (1,0)), and the texture's side in pixels.
 */
export function boxLightmap(
  sx: number,
  sy: number,
  sz: number,
): { uv: Float32Array; side: number } {
  const faces: [number, number][] = [
    [sz, sy],
    [sz, sy],
    [sx, sz],
    [sx, sz],
    [sx, sy],
    [sx, sy],
  ];
  const area = faces.reduce((sum, [w, h]) => sum + w * h, 0);
  const side = Math.min(
    1024,
    Math.max(32, 2 ** Math.ceil(Math.log2(Math.sqrt(area) * TEXELS_PER_M * 1.5))),
  );
  const order = [0, 1, 2, 3, 4, 5].sort((a, b) => (faces[b]?.[1] ?? 0) - (faces[a]?.[1] ?? 0));
  let k = side / Math.sqrt(area);
  for (let tries = 0; tries < 200; tries++, k *= 0.92) {
    const rects: [number, number, number, number][] = [];
    let x = PAD;
    let y = PAD;
    let row = 0;
    let fits = true;
    for (const f of order) {
      const [fw, fh] = faces[f] as [number, number];
      const w = Math.max(1, Math.ceil(fw * k));
      const h = Math.max(1, Math.ceil(fh * k));
      if (x + w + PAD > side) {
        x = PAD;
        y += row + PAD;
        row = 0;
      }
      if (x + w + PAD > side || y + h + PAD > side) fits = false;
      rects[f] = [x, y, w, h];
      x += w + PAD;
      row = Math.max(row, h);
    }
    if (!fits) continue;
    const corners = [0, 1, 1, 1, 0, 0, 1, 0];
    const uv = new Float32Array(48);
    for (let f = 0; f < 6; f++) {
      const [rx, ry, rw, rh] = rects[f] as [number, number, number, number];
      for (let c = 0; c < 4; c++) {
        uv[(f * 4 + c) * 2] = (rx + (corners[c * 2] ?? 0) * rw) / side;
        uv[(f * 4 + c) * 2 + 1] = (ry + (corners[c * 2 + 1] ?? 0) * rh) / side;
      }
    }
    return { uv, side };
  }
  throw new Error("a box too thin to light");
}
