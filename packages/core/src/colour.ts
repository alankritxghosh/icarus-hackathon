/** Colours measured from a photograph's pixels, as #rrggbb. Each is absent when the photo gives no clear answer. */
export interface MeasuredColours {
  floor?: string;
  wall?: string;
  accent?: string;
}

const hex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

function hsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max / 255];
}

/**
 * Measure a photo with plain arithmetic, so the colours never depend on a model's guess.
 * `data` is RGBA, row by row. The floor is read from the lower middle, the wall from the brightest
 * quiet pixels in the upper middle, and the accent from the most common saturated hue away from the floor.
 */
export function dominantColours(
  data: ArrayLike<number>,
  width: number,
  height: number,
): MeasuredColours {
  const at = (x: number, y: number): [number, number, number] => {
    const i = (y * width + x) * 4;
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
  };
  const mean = (
    x0: number,
    x1: number,
    y0: number,
    y1: number,
    keep?: (c: [number, number, number]) => boolean,
  ) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = Math.floor(y0 * height); y < Math.floor(y1 * height); y += 2)
      for (let x = Math.floor(x0 * width); x < Math.floor(x1 * width); x += 2) {
        const c = at(x, y);
        if (keep && !keep(c)) continue;
        r += c[0];
        g += c[1];
        b += c[2];
        n++;
      }
    return n > 0 ? ([r / n, g / n, b / n] as const) : undefined;
  };

  const out: MeasuredColours = {};
  const floor = mean(0.2, 0.8, 0.78, 1);
  if (floor) out.floor = hex(...floor);
  const wall = mean(0.1, 0.9, 0.12, 0.45, (c) => {
    const [, s, v] = hsv(...c);
    return s < 0.2 && v > 0.55;
  });
  if (wall) out.wall = hex(...wall);

  // Hue histogram of saturated pixels in the band between the ceiling and the floor.
  const bins = Array.from({ length: 12 }, () => ({ weight: 0, r: 0, g: 0, b: 0 }));
  for (let y = Math.floor(0.2 * height); y < Math.floor(0.78 * height); y += 2)
    for (let x = 0; x < width; x += 2) {
      const c = at(x, y);
      const [h, s, v] = hsv(...c);
      if (s < 0.35 || v < 0.25) continue;
      const bin = bins[Math.floor(h / 30) % 12];
      if (!bin) continue;
      const w = s * v;
      bin.weight += w;
      bin.r += c[0] * w;
      bin.g += c[1] * w;
      bin.b += c[2] * w;
    }
  const best = bins.reduce((a, b) => (b.weight > a.weight ? b : a));
  const total = bins.reduce((s, b) => s + b.weight, 0);
  // Only call it an accent if one hue clearly stands out.
  if (best.weight > 0 && best.weight / total > 0.3 && total > (width * height) / 4000)
    out.accent = hex(best.r / best.weight, best.g / best.weight, best.b / best.weight);
  return out;
}
