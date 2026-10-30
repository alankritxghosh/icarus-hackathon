// Runs poppler on a PDF and hands its two text views to `extractEvidence`. Needs `pdftocairo` and `pdftotext`
// (poppler-utils) on the PATH; anything else that can produce the same two views can call `extractEvidence` directly.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { type ExtractedEvidence, type ExtractOptions, extractEvidence } from "../src/pdfEvidence";

const run = promisify(execFile);

/** The two views of one page: an SVG of its shapes and an XHTML of its words with their boxes. */
export interface PdfViews {
  svg: string;
  bboxHtml: string;
}

async function views(pdfPath: string, dir: string, page: number): Promise<PdfViews> {
  const p = String(page);
  try {
    await run("pdftocairo", ["-svg", "-f", p, "-l", p, pdfPath, join(dir, "page.svg")]);
    await run("pdftotext", ["-bbox-layout", "-f", p, "-l", p, pdfPath, join(dir, "page.html")]);
  } catch (e) {
    const code = (e as { code?: string }).code;
    throw new Error(
      code === "ENOENT"
        ? "poppler is not installed (pdftocairo, pdftotext): install poppler-utils"
        : `poppler could not read ${basename(pdfPath)}: ${(e as Error).message}`,
    );
  }
  const [svg, bboxHtml] = await Promise.all([
    readFile(join(dir, "page.svg"), "utf8"),
    readFile(join(dir, "page.html"), "utf8"),
  ]);
  return { svg, bboxHtml };
}

/** The views of page `page` of a PDF held in memory. */
export async function pdfViewsFromBytes(bytes: Uint8Array, page = 1): Promise<PdfViews> {
  const dir = await mkdtemp(join(tmpdir(), "icarus-views-"));
  try {
    const file = join(dir, "sheet.pdf");
    await writeFile(file, bytes);
    return await views(file, dir, page);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Whether poppler is installed here. */
export async function hasPoppler(): Promise<boolean> {
  try {
    await run("pdftocairo", ["-v"]);
    await run("pdftotext", ["-v"]);
    return true;
  } catch (e) {
    // Both tools print their version to stderr and some builds exit non-zero for -v; only a missing binary counts.
    return (e as { code?: string }).code !== "ENOENT";
  }
}

export async function extractEvidenceFromPdf(
  pdfPath: string,
  opts: ExtractOptions,
  page = 1,
): Promise<ExtractedEvidence> {
  const dir = await mkdtemp(join(tmpdir(), "icarus-evidence-"));
  try {
    const { svg, bboxHtml } = await views(pdfPath, dir, page);
    return extractEvidence(svg, bboxHtml, basename(pdfPath), opts);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
