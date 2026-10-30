import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const run = promisify(execFile);

async function body(req: IncomingMessage, limit: number): Promise<Buffer | undefined> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) return undefined;
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Development only: answers /api/drawing/views with the poppler installed on this machine, so a drawing can be
 * checked without deploying the Modal worker. Without poppler it passes the request on to the edge Worker.
 */
function localDrawingViews(): Plugin {
  return {
    name: "icarus-local-drawing-views",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/drawing/views", async (req, res, next) => {
        try {
          await run("pdftocairo", ["-v"]).catch((e: { code?: string }) => {
            if (e.code === "ENOENT") throw e;
          });
        } catch {
          return next();
        }
        const send = (status: number, payload: unknown) => {
          res.statusCode = status;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(payload));
        };
        if (req.method !== "POST") return send(405, { error: "method not allowed" });
        const pdf = await body(req, 8 * 1024 * 1024);
        if (!pdf) return send(413, { error: "that PDF is too large" });
        if (pdf.subarray(0, 5).toString("latin1") !== "%PDF-")
          return send(400, { error: "that is not a PDF" });
        const page = Number(new URL(req.url ?? "", "http://x").searchParams.get("page") ?? "1");
        if (!Number.isInteger(page) || page < 1 || page > 50)
          return send(400, { error: "page must be 1 to 50" });
        const dir = await mkdtemp(join(tmpdir(), "icarus-dev-drawing-"));
        try {
          const src = join(dir, "sheet.pdf");
          await writeFile(src, pdf);
          const p = String(page);
          await run("pdftocairo", ["-svg", "-f", p, "-l", p, src, join(dir, "page.svg")]);
          await run("pdftotext", ["-bbox-layout", "-f", p, "-l", p, src, join(dir, "page.html")]);
          send(200, {
            svg: await readFile(join(dir, "page.svg"), "utf8"),
            bboxHtml: await readFile(join(dir, "page.html"), "utf8"),
            page,
          });
        } catch {
          send(422, { error: "that PDF could not be read" });
        } finally {
          await rm(dir, { recursive: true, force: true });
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localDrawingViews()],
  // In development the picture service is the edge Worker (`pnpm --filter @icarus/edge dev`, port 8789).
  server: { proxy: { "/api": process.env.ICARUS_EDGE ?? "http://localhost:8789" } },
});
