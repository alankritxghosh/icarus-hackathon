import { MetaError } from "./errors";
import type { SamMatch } from "./types";

const FRAME = /<(\d+)f>/g;
const RECORD =
  /(\d+)<\|box;x1=(\d+);y1=(\d+);x2=(\d+);y2=(\d+);w=(\d+);h=(\d+)(?:;c=([0-9.]+))?\|><\|mask;x=0;y=0(?:;c=[0-9.]+)?;data=(\d+),(\d+),([~!])(.*?)\|>/gs;

/**
 * Read SAM 3.1's special-token text into matches: one box and one mask per object, per frame.
 * An empty string is a valid answer (nothing matched). Text with tokens it cannot read is an
 * error, so a format change cannot silently turn into "no objects found".
 */
export function parseSegmentation(text: string): SamMatch[] {
  const body = text.trim();
  if (!body) return [];
  const frames = [...body.matchAll(FRAME)];
  if (frames.length === 0)
    throw new MetaError("invalid_response", "segmentation output had no frame marker");
  const matches: SamMatch[] = [];
  frames.forEach((marker, i) => {
    const start = (marker.index ?? 0) + marker[0].length;
    const end = frames[i + 1]?.index ?? body.length;
    for (const m of body.slice(start, end).matchAll(RECORD)) {
      const n = (k: number) => Number(m[k]);
      matches.push({
        frame: Number(marker[1]),
        id: n(1),
        box: { x1: n(2), y1: n(3), x2: n(4), y2: n(5), w: n(6), h: n(7) },
        confidence: m[8] === undefined ? undefined : Number(m[8]),
        mask: {
          rows: n(9),
          cols: n(10),
          encoding: m[11] === "!" ? "one_bit" : "lossless",
          payload: m[12] ?? "",
        },
      });
    }
  });
  if (matches.length === 0)
    throw new MetaError("invalid_response", "segmentation output contained no readable records");
  return matches;
}
