// Works out how many millimetres one unit of a PDF drawing is, from the sheet itself, so nobody has to type a scale.
//
// Two sources, in order of trust:
//  1. Dimension strings. CAD plans print lengths such as 11'-3" beside a dimension line. Each such text gives a length in
//     millimetres, and the straight stroked lines lying under or beside it give candidate lengths in sheet units. Many
//     texts agreeing on one ratio decide the scale; a text paired with the wrong line, or with no line, is outvoted.
//  2. A printed scale ("SCALE 1:100"), which is only as true as the plotted size of the sheet.
// It throws when neither is there. It never invents a scale.
import {
  type ExtractedEvidence,
  type ExtractOptions,
  extractEvidence,
  strokedSegments,
  unitMmFromScale,
} from "./pdfEvidence";

export interface ScaleEstimate {
  /** Millimetres per PDF unit. */
  unitMm: number;
  basis: "dimension strings" | "scale text";
  /** Dimension strings that agreed with the answer, of those that could be paired with a line. */
  agreeing: number;
  of: number;
  notes: string[];
}

interface Dimension {
  mm: number;
  /** Text box, in sheet units. */
  box: [number, number, number, number];
}

const DIM = /^(\d+)'(?:-?(\d+(?:\.\d+)?)")?$/;

/** Single lengths such as 11'-3" or 4' printed on their own, with where they sit. */
function dimensions(bboxHtml: string): Dimension[] {
  const out: Dimension[] = [];
  for (const m of bboxHtml.matchAll(
    /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g,
  )) {
    const text = (m[5] as string)
      .replace(/&apos;|&#39;|[’′]/g, "'")
      .replace(/&quot;|[”″]/g, '"')
      .trim();
    const d = DIM.exec(text);
    if (!d) continue;
    const mm = (Number(d[1]) * 12 + Number(d[2] ?? 0)) * 25.4;
    if (mm < 300) continue;
    out.push({ mm, box: [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] });
  }
  return out;
}

const SCALE_TEXT = /\bscale\s*[:=-]?\s*1\s*[:/]\s*(\d{1,4})\b/i;

export function estimateUnitMm(svg: string, bboxHtml: string): ScaleEstimate {
  const notes: string[] = [];
  const dims = dimensions(bboxHtml);
  const segments = strokedSegments(svg);

  // Candidate ratios per dimension: every line parallel to the text, running under it, within a few text heights.
  const perDim: number[][] = [];
  for (const d of dims) {
    const [x0, y0, x1, y1] = d.box;
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const horizontal = x1 - x0 >= y1 - y0;
    const h = horizontal ? y1 - y0 : x1 - x0;
    const along = horizontal ? cx : cy;
    const across = horizontal ? cy : cx;
    const found: number[] = [];
    for (const s of segments) {
      const sh = Math.abs(s.a[1] - s.b[1]) < 0.02;
      if (sh !== horizontal) continue;
      const lineAcross = horizontal ? s.a[1] : s.a[0];
      const lo = Math.min(horizontal ? s.a[0] : s.a[1], horizontal ? s.b[0] : s.b[1]);
      const hi = Math.max(horizontal ? s.a[0] : s.a[1], horizontal ? s.b[0] : s.b[1]);
      if (Math.abs(lineAcross - across) > 4 * h || along < lo || along > hi || hi - lo < 2 * h)
        continue;
      found.push(d.mm / (hi - lo));
    }
    if (found.length) perDim.push(found);
  }

  // The ratio most dimension strings agree on, and the best rival more than 5% away. A real scale stands well clear of
  // the accidental agreements that many short lines produce.
  const support = (r: number) => {
    const hits: number[] = [];
    for (const cands of perDim) {
      const hit = cands.find((c) => Math.abs(c - r) / r <= 0.015);
      if (hit !== undefined) hits.push(hit);
    }
    return hits;
  };
  const all = [...new Set(perDim.flat().map((r) => Math.round(r * 1000) / 1000))].sort(
    (p, q) => p - q,
  );
  let best: number[] = [];
  for (const r of all) {
    const hits = support(r);
    if (hits.length > best.length) best = hits;
  }
  const centre = best.length
    ? ([...best].sort((p, q) => p - q)[Math.floor(best.length / 2)] as number)
    : 0;
  let rival = 0;
  for (const r of all)
    if (Math.abs(r - centre) / (centre || 1) > 0.05) rival = Math.max(rival, support(r).length);
  const printed = SCALE_TEXT.exec(bboxHtml.replace(/<[^>]*>/g, " "));
  if (best.length >= 5 && best.length >= 2 * rival) {
    const unitMm = centre;
    if (printed) {
      const stated = unitMmFromScale(Number(printed[1]));
      if (Math.abs(stated - unitMm) / unitMm > 0.05)
        notes.push(
          `the sheet says scale 1:${printed[1]} but its dimension strings imply 1:${Math.round(unitMm / unitMmFromScale(1))}; using the dimension strings`,
        );
    }
    return { unitMm, basis: "dimension strings", agreeing: best.length, of: perDim.length, notes };
  }
  notes.push(
    perDim.length < 4
      ? `only ${perDim.length} dimension strings could be paired with a line`
      : `${best.length} of ${perDim.length} dimension strings agreed and a rival ratio had ${rival}: not clear enough to trust`,
  );
  if (printed)
    return {
      unitMm: unitMmFromScale(Number(printed[1])),
      basis: "scale text",
      agreeing: 0,
      of: 0,
      notes: [
        ...notes,
        `the sheet prints scale 1:${printed[1]}; that is only true if it was plotted at that size`,
      ],
    };
  throw new Error(
    `the scale could not be read from the sheet: ${notes.join("; ")}. Enter the scale it was printed at.`,
  );
}

/** Reads a sheet without being told its scale: estimates it, then extracts as usual. Throws if the scale cannot be read. */
export function extractEvidenceAuto(
  svg: string,
  bboxHtml: string,
  source: string,
  opts: Omit<ExtractOptions, "unitMm"> = {},
): ExtractedEvidence & { scale: ScaleEstimate } {
  const scale = estimateUnitMm(svg, bboxHtml);
  const out = extractEvidence(svg, bboxHtml, source, { ...opts, unitMm: scale.unitMm });
  out.report.assumptions.unshift(
    scale.basis === "dimension strings"
      ? `the scale is ${scale.unitMm.toFixed(2)} mm per unit, read from ${scale.agreeing} of ${scale.of} dimension strings (about 1:${Math.round(scale.unitMm / unitMmFromScale(1))})`
      : `the scale is ${scale.unitMm.toFixed(2)} mm per unit, from the sheet's printed scale`,
  );
  return { ...out, scale };
}
