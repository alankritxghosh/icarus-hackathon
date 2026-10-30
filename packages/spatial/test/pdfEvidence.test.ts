import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  anchorEvidence,
  auditAgainstDrawing,
  extractEvidence,
  filledRects,
  parseColour,
  parsePrintedSize,
  type Rect,
  unitMmFromScale,
} from "../src";
import { extractEvidenceFromPdf } from "../tools/pdfEvidenceNode";

const BROWN = "rgb(80.39%, 41.18%, 15.68%)";
const path = (fill: string, d: string, extra = "") =>
  `<path fill-rule="nonzero" fill="${fill}" fill-opacity="1" d="${d}" ${extra}/>`;
const box = (x0: number, y0: number, x1: number, y1: number) =>
  `M ${x0} ${y0} L ${x1} ${y0} L ${x1} ${y1} L ${x0} ${y1} Z`;
const svgOf = (body: string) =>
  `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 842 595">${body}</svg>`;
const sorted = (rs: readonly Rect[]) => [...rs].map((r) => r.join(",")).sort();

describe("reading shapes", () => {
  it("reads filled rectangles, applies group transforms, ignores defs and clip paths", () => {
    const svg = svgOf(
      `<defs><clipPath id="c">${path("rgb(0%, 0%, 0%)", box(0, 0, 842, 595))}</clipPath></defs>` +
        `<g transform="matrix(1, 0, 0, 1, 10, 20)">${path(BROWN, box(0, 0, 100, 10))}</g>` +
        path(BROWN, "m 50 50 h 20 v 30 h -20 z"),
    );
    const { rects } = filledRects(svg);
    expect(rects.map((r) => r.rect)).toEqual([
      [10, 20, 110, 30],
      [50, 50, 70, 80],
    ]);
  });

  it("counts curves and slanted shapes as not read, and an outline with a hole as hollow", () => {
    const svg = svgOf(
      path(BROWN, "M 0 0 C 1 1 2 2 3 3 Z") +
        path(BROWN, "M 0 0 L 10 5 L 20 0 L 10 -5 Z") +
        path(BROWN, `${box(0, 0, 50, 50)} ${box(10, 10, 40, 40)}`),
    );
    const r = filledRects(svg);
    expect(r.rects).toEqual([]);
    expect(r.notRectangle).toBe(2);
    expect(r.hollow).toBe(1);
  });

  it("reads CAD fills drawn as triangles: a rectangle, an L-shaped corner, and refuses a slanted shape", () => {
    const tri = (a: number[], b: number[], c: number[]) =>
      `M ${a[0]} ${a[1]} L ${b[0]} ${b[1]} L ${c[0]} ${c[1]} Z`;
    // 100 x 20 bar as two triangles, with the stray moveto poppler leaves at the end of every shape.
    const bar = `${tri([0, 0], [100, 0], [100, 20])} ${tri([0, 0], [100, 20], [0, 20])} M 0 0`;
    // An L: the bar plus a 20 x 80 leg below its left end, four triangles in one path.
    const ell = `${bar} ${tri([0, 20], [20, 20], [20, 100])} ${tri([0, 20], [20, 100], [0, 100])}`;
    const slanted = `${tri([0, 0], [100, 0], [100, 20])} ${tri([0, 0], [100, 20], [0, 40])}`;
    expect(filledRects(svgOf(path(BROWN, bar))).rects.map((r) => r.rect)).toEqual([
      [0, 0, 100, 20],
    ]);
    const l = filledRects(svgOf(path(BROWN, ell))).rects.map((r) => r.rect);
    const area = l.reduce((acc, r) => acc + (r[2] - r[0]) * (r[3] - r[1]), 0);
    expect(area).toBe(100 * 20 + 20 * 80);
    expect(l.every((r) => r[2] - r[0] <= 100 && r[3] - r[1] <= 100)).toBe(true);
    const bad = filledRects(svgOf(path(BROWN, slanted)));
    expect(bad.rects).toEqual([]);
    expect(bad.notRectangle).toBeGreaterThan(0);
  });

  it("parses colours and printed sizes", () => {
    expect(parseColour(BROWN)).toEqual([205, 105, 40]);
    expect(parseColour("#ff0000")).toEqual([255, 0, 0]);
    expect(parseColour("none")).toBeUndefined();
    expect(parsePrintedSize(`10'0" x 12'0"`)).toEqual([3048, 3657.6]);
    expect(parsePrintedSize(`10'2" x 10'0"`)?.map(Math.round)).toEqual([3099, 3048]);
    expect(parsePrintedSize("3.2 x 4.1 m")).toEqual([3200, 4100]);
    expect(parsePrintedSize("MASTER BEDROOM")).toBeUndefined();
    expect(unitMmFromScale(100)).toBeCloseTo(35.2778, 3);
  });
});

const word = (t: string, x0: number, y0: number, x1: number, y1: number) =>
  `<word xMin="${x0}" yMin="${y0}" xMax="${x1}" yMax="${y1}">${t}</word>`;
const block = (lines: string[][], box4: [number, number, number, number]) =>
  `<block xMin="${box4[0]}" yMin="${box4[1]}" xMax="${box4[2]}" yMax="${box4[3]}">${lines
    .map(
      (words, i) =>
        `<line xMin="${box4[0]}" yMin="${box4[1] + i * 14}" xMax="${box4[2]}" yMax="${box4[1] + i * 14 + 12}">${words.join("")}</line>`,
    )
    .join("")}</block>`;

describe("extractEvidence", () => {
  // 1 unit = 10 mm. Four outer walls 20 units thick around x 100..700, y 100..300, one inner wall.
  const walls =
    path(BROWN, box(100, 100, 700, 120)) +
    path(BROWN, box(100, 280, 700, 300)) +
    path(BROWN, box(100, 120, 120, 280)) +
    path(BROWN, box(680, 120, 700, 280)) +
    path(BROWN, box(395, 120, 415, 280));
  const text =
    `<doc><page>` +
    block(
      [
        [word("BEDROOM", 150, 180, 210, 192)],
        [
          word(`10'0"`, 150, 194, 175, 206),
          word("x", 176, 194, 182, 206),
          word(`12'0"`, 183, 194, 210, 206),
        ],
      ],
      [150, 180, 210, 206],
    ) +
    block(
      [
        [
          word("FOURTH", 300, 500, 350, 512),
          word("FLOOR", 352, 500, 390, 512),
          word("PLAN", 392, 500, 420, 512),
        ],
      ],
      [300, 500, 420, 512],
    ) +
    block([[word("GYM", 500, 190, 530, 202)]], [500, 190, 530, 202]) +
    `</page></doc>`;
  const svg = svgOf(
    walls +
      path("rgb(100%, 0%, 0%)", box(300, 200, 320, 220)) +
      path("rgb(0%, 0%, 100%)", box(500, 150, 540, 180)) +
      path(BROWN, box(130, 200, 230, 201)),
  );

  it("finds the walls by colour, puts the building at the origin, keeps labels inside it and drops the rest", () => {
    const { evidence, report } = extractEvidence(svg, text, "test.pdf", {
      unitMm: 10,
      supportColours: [[255, 0, 0]],
    });
    expect(sorted(evidence.wallRects)).toEqual(
      sorted([
        [0, 0, 6000, 200],
        [0, 1800, 6000, 2000],
        [0, 200, 200, 1800],
        [5800, 200, 6000, 1800],
        [2950, 200, 3150, 1800],
      ]),
    );
    expect(evidence.supportRects).toEqual([[2000, 1000, 2200, 1200]]);
    expect(report.dropped).toMatchObject({ otherColour: 1, tooThin: 1 });
    expect(report.assumptions.join(" ")).toMatch(/walls are the fill rgb\(205, 105, 40\)/);
    expect(evidence.labels.map((l) => l.text)).toEqual(["BEDROOM", "GYM"]);
    expect(evidence.labels[0]?.printedSizeMm).toEqual([3048, 3658]);
    expect(evidence.labels[0]?.at).toEqual([800, 860]);
    expect(report.labelsIgnored.join(" ")).toMatch(/FOURTH FLOOR PLAN/);
  });

  it("attaches a size printed in a block of its own to the label just above it", () => {
    const t =
      `<doc><page>` +
      block([[word("GYM", 500, 190, 530, 202)]], [500, 190, 530, 202]) +
      block(
        [
          [
            word("(10'2\"", 495, 210, 515, 220),
            word("X", 516, 210, 522, 220),
            word("10'0\")", 523, 210, 545, 220),
          ],
        ],
        [495, 210, 545, 220],
      ) +
      `</page></doc>`;
    const { evidence } = extractEvidence(svg, t, "t", { unitMm: 10 });
    expect(evidence.labels).toHaveLength(1);
    expect(evidence.labels[0]?.printedSizeMm?.map(Math.round)).toEqual([3099, 3048]);
  });

  it("uses the colours it is told to instead of guessing", () => {
    const { report } = extractEvidence(svg, text, "t", {
      unitMm: 10,
      wallColours: [[205, 105, 40]],
    });
    expect(report.assumptions.join(" ")).not.toMatch(/walls are the fill/);
  });

  it("refuses a drawing with no wall shapes rather than returning an empty pass", () => {
    expect(() => extractEvidence(svgOf(""), "<doc/>", "scan.pdf", { unitMm: 10 })).toThrow(
      /no wall fill found/,
    );
  });

  it("slides evidence into a model's frame", () => {
    const { evidence } = extractEvidence(svg, text, "t", { unitMm: 10 });
    const moved = anchorEvidence(evidence, 100, 100);
    expect(moved.wallRects[0]).toEqual([
      (evidence.wallRects[0]?.[0] as number) + 100,
      (evidence.wallRects[0]?.[1] as number) + 100,
      (evidence.wallRects[0]?.[2] as number) + 100,
      (evidence.wallRects[0]?.[3] as number) + 100,
    ]);
    expect(moved.labels[0]?.at).toEqual([900, 960]);
  });
});

// The real thing end to end, on a PDF this test writes byte by byte, when poppler is installed.
const hasPoppler = (() => {
  try {
    execFileSync("pdftocairo", ["-v"], { stdio: "ignore" });
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

function pdf(content: string): string {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

describe.skipIf(!hasPoppler)("extractEvidenceFromPdf (needs poppler)", () => {
  it("reads a hand-written PDF and the audit then passes a model drawn to it and fails one with an extra wall", async () => {
    // PDF y runs up. 1 unit = 10 mm. Building x 100..700, y 200..420.
    const re = (x: number, y: number, w: number, h: number) => `${x} ${y} ${w} ${h} re f`;
    const content = [
      "0.8039 0.4118 0.1569 rg",
      re(100, 400, 600, 20),
      re(100, 200, 600, 20),
      re(100, 200, 20, 220),
      re(680, 200, 20, 220),
      re(395, 220, 20, 180),
      "0 0 1 rg",
      re(500, 250, 40, 30),
      "0 0 0 rg",
      "BT /F1 12 Tf 200 330 Td (BEDROOM) Tj ET",
      "BT /F1 12 Tf 200 314 Td (10'0\" x 12'0\") Tj ET",
      "BT /F1 12 Tf 500 330 Td (GYM) Tj ET",
      "BT /F1 12 Tf 300 60 Td (FOURTH FLOOR PLAN) Tj ET",
    ].join("\n");
    const dir = mkdtempSync(join(tmpdir(), "icarus-pdf-test-"));
    try {
      const file = join(dir, "sheet.pdf");
      writeFileSync(file, pdf(content), "latin1");
      const { evidence, report } = await extractEvidenceFromPdf(file, { unitMm: 10 });
      expect(sorted(evidence.wallRects)).toEqual(
        sorted([
          [0, 0, 6000, 200],
          [0, 2000, 6000, 2200],
          [0, 0, 200, 2200],
          [5800, 0, 6000, 2200],
          [2950, 200, 3150, 2000],
        ]),
      );
      expect(report.dropped.otherColour).toBe(1);
      expect(evidence.labels.map((l) => l.text).sort()).toEqual(["BEDROOM", "GYM"]);
      expect(evidence.labels.find((l) => l.text === "BEDROOM")?.printedSizeMm).toEqual([
        3048, 3658,
      ]);

      // The audit on a model that matches: no wall errors. Then one extra wall is caught.
      const wall = (id: string, ax: number, ay: number, bx: number, by: number) => ({
        id,
        levelId: "L1",
        a: { x: ax, y: ay },
        b: { x: bx, y: by },
        thicknessMm: 200,
        kind: "interior" as const,
        structural: "unknown" as const,
        glazed: false,
        provenance: { source: "generated" as const, evidence: [] },
      });
      const sq = (x0: number, y0: number, x1: number, y1: number) => ({
        outer: [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 },
        ],
        holes: [],
      });
      const space = (id: string, name: string, x0: number, x1: number) => ({
        id,
        levelId: "L1",
        kind: "residential.room",
        name,
        boundary: sq(x0, 200, x1, 2000),
        programme: {},
        locked: false,
        provenance: { source: "generated" as const, evidence: [] },
      });
      const model = {
        schema: "icarus.spatial/0.1" as const,
        units: "mm" as const,
        name: "m",
        northDeg: 0,
        levels: [
          {
            id: "L1",
            name: "G",
            elevationMm: 0,
            heightMm: 3000,
            boundary: sq(0, 0, 6000, 2200),
            provenance: { source: "generated" as const, evidence: [] },
          },
        ],
        spaces: [space("a", "Bedroom", 200, 2950), space("b", "Gym", 3150, 5800)],
        walls: [
          wall("n", 0, 100, 6000, 100),
          wall("s", 0, 2100, 6000, 2100),
          wall("w", 100, 0, 100, 2200),
          wall("e", 5900, 0, 5900, 2200),
          wall("m", 3050, 200, 3050, 2000),
        ],
        openings: [],
        obstacles: [],
        connectors: [],
        items: [],
      };
      expect(
        auditAgainstDrawing(model, evidence).findings.filter((f) => f.level === "error"),
      ).toEqual([]);
      model.walls.push(wall("extra", 800, 1000, 2500, 1000));
      expect(auditAgainstDrawing(model, evidence).findings.map((f) => f.code)).toContain(
        "wall_not_in_drawing",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("says so when a file is not a PDF", async () => {
    const dir = mkdtempSync(join(tmpdir(), "icarus-pdf-test-"));
    try {
      const file = join(dir, "bad.pdf");
      writeFileSync(file, "not a pdf");
      await expect(extractEvidenceFromPdf(file, { unitMm: 10 })).rejects.toThrow(
        /could not read bad.pdf/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

import { alignEvidenceToModel } from "../src";

describe("alignEvidenceToModel", () => {
  it("moves the sheet's outer corner onto the model's, allowing for half a wall", () => {
    const ev = {
      schema: "icarus.drawing-evidence/0.1" as const,
      source: "t",
      wallRects: [[0, 0, 6000, 200]] as Rect[],
      supportRects: [],
      labels: [{ text: "A", at: [100, 100] as const, role: "room" as const }],
    };
    const model = {
      walls: [
        { a: { x: 1100, y: 2100 }, b: { x: 7000, y: 2100 }, kind: "exterior", thicknessMm: 200 },
      ],
    };
    const out = alignEvidenceToModel(ev, model as never);
    expect(out.shiftMm).toEqual([1000, 2000]);
    expect(out.evidence.wallRects[0]).toEqual([1000, 2000, 7000, 2200]);
    expect(out.evidence.labels[0]?.at).toEqual([1100, 2100]);
  });
});
