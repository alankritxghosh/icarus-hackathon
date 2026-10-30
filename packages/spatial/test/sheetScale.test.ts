import { describe, expect, it } from "vitest";
import { estimateUnitMm, extractEvidenceAuto, unitMmFromScale } from "../src";

// A hand-made sheet at 10 mm per unit: dimension lines with their texts, so the right answer is known.
const word = (t: string, cx: number, cy: number, vertical = false) =>
  vertical
    ? `<word xMin="${cx - 3}" yMin="${cy - 10}" xMax="${cx + 3}" yMax="${cy + 10}">${t}</word>`
    : `<word xMin="${cx - 10}" yMin="${cy - 3}" xMax="${cx + 10}" yMax="${cy + 3}">${t}</word>`;
const line = (x0: number, y0: number, x1: number, y1: number) =>
  `<path fill="none" stroke="rgb(0%, 0%, 0%)" stroke-width="1" d="M ${x0} ${y0} L ${x1} ${y1}"/>`;
const svgOf = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">${body}</svg>`;
const html = (words: string[]) => `<doc><page>${words.join("")}</page></doc>`;

// Lengths in whole feet so the printed text is exact: 10 mm per unit means L units = L * 10 mm.
const FEET = [10, 15, 5, 20, 8, 12, 6];
function sheet(unit = 10) {
  const lines: string[] = [];
  const words: string[] = [];
  FEET.forEach((ft, i) => {
    const len = (ft * 304.8) / unit;
    const y = 40 + i * 60;
    lines.push(line(50, y, 50 + len, y));
    words.push(word(`${ft}'`, 50 + len / 2, y - 4));
  });
  // Short extension lines and a decoy that agrees with nothing.
  lines.push(line(40, 20, 40, 400), line(100, 500, 130, 500));
  return { svg: svgOf(lines.join("")), html: html(words) };
}

describe("estimateUnitMm", () => {
  it("reads the scale from dimension strings and the lines under them", () => {
    const s = sheet(10);
    const e = estimateUnitMm(s.svg, s.html);
    expect(e.basis).toBe("dimension strings");
    expect(e.unitMm).toBeCloseTo(10, 1);
    expect(e.agreeing).toBeGreaterThanOrEqual(5);
  });

  it("reads a different scale just as well, and vertical dimensions too", () => {
    const s = sheet(25);
    expect(estimateUnitMm(s.svg, s.html).unitMm).toBeCloseTo(25, 1);
    const len = (10 * 304.8) / 10;
    const vertical = estimateUnitMm(
      svgOf(
        [
          line(100, 50, 100, 50 + len),
          line(160, 50, 160, 50 + 1.5 * len),
          line(220, 50, 220, 50 + 0.5 * len),
          line(280, 50, 280, 50 + 2 * len),
          line(340, 50, 340, 50 + 0.8 * len),
        ].join(""),
      ),
      html([
        word("10'", 105, 50 + len / 2, true),
        word("15'", 165, 50 + 0.75 * len, true),
        word("5'", 225, 50 + 0.25 * len, true),
        word("20'", 285, 50 + len, true),
        word("8'", 345, 50 + 0.4 * len, true),
      ]),
    );
    expect(vertical.unitMm).toBeCloseTo(10, 1);
  });

  it("falls back to a printed scale, saying so, and refuses when there is nothing to go on", () => {
    const text = estimateUnitMm(
      svgOf(""),
      html([
        '<word xMin="1" yMin="1" xMax="9" yMax="4">SCALE</word><word xMin="10" yMin="1" xMax="19" yMax="4">1:50</word>',
      ]),
    );
    expect(text.basis).toBe("scale text");
    expect(text.unitMm).toBeCloseTo(unitMmFromScale(50), 6);
    expect(() => estimateUnitMm(svgOf(""), html([]))).toThrow(/could not be read.*Enter the scale/);
  });

  it("is not fooled when only a couple of dimensions agree", () => {
    const s = sheet(10);
    // Keep just three of the seven texts.
    const few = html(
      FEET.slice(0, 3).map((ft, i) => word(`${ft}'`, 50 + (ft * 30.48) / 2, 40 + i * 60 - 4)),
    );
    expect(() => estimateUnitMm(s.svg, few)).toThrow(/could not be read/);
  });
});

describe("extractEvidenceAuto", () => {
  it("extracts walls at the scale it read, and says where the scale came from", () => {
    const BROWN = "rgb(80.39%, 41.18%, 15.68%)";
    const wall = (x0: number, y0: number, x1: number, y1: number) =>
      `<path fill="${BROWN}" fill-opacity="1" d="M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z"/>`;
    const s = sheet(10);
    const svg = s.svg.replace(
      "</svg>",
      `${wall(300, 400, 700, 420)}${wall(300, 560, 700, 580)}${wall(300, 420, 320, 560)}${wall(680, 420, 700, 560)}</svg>`,
    );
    const out = extractEvidenceAuto(svg, s.html, "t.pdf");
    expect(out.scale.unitMm).toBeCloseTo(10, 1);
    expect(out.evidence.wallRects).toHaveLength(4);
    expect(out.report.assumptions[0]).toMatch(
      /mm per unit, read from \d+ of \d+ dimension strings/,
    );
    // 400 units wide at 10 mm per unit is 4 m.
    expect(out.evidence.wallRects[0]?.[2]).toBeCloseTo(4000, -1);
  });
});
