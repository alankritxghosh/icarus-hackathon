// Runs poppler on a PDF and hands its two text views to `extractEvidence`. Needs `pdftocairo` and `pdftotext`
// (poppler-utils) on the PATH; anything else that can produce the same two views can call `extractEvidence` directly.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { type ExtractedEvidence, type ExtractOptions, extractEvidence } from "../src/pdfEvidence";

const run = promisify(execFile);

export async function extractEvidenceFromPdf(
  pdfPath: string,
  opts: ExtractOptions,
  page = 1,
): Promise<ExtractedEvidence> {
  const dir = await mkdtemp(join(tmpdir(), "icarus-evidence-"));
  try {
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
    const [svg, html] = await Promise.all([
      readFile(join(dir, "page.svg"), "utf8"),
      readFile(join(dir, "page.html"), "utf8"),
    ]);
    return extractEvidence(svg, html, basename(pdfPath), opts);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
