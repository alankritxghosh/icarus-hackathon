import { z } from "zod";
import type { Env } from "./env";

const MAX_PDF_BYTES = 8 * 1024 * 1024;
const MAX_VIEW_BYTES = 24 * 1024 * 1024;

const Views = z.object({
  svg: z.string().max(MAX_VIEW_BYTES),
  bboxHtml: z.string().max(MAX_VIEW_BYTES),
  page: z.int().min(1).max(50),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * POST /api/drawing/views?page=1 with the PDF as the body. Hands the file to the Modal drawing worker, which runs
 * poppler, and returns the page's shapes and words for the browser to read into evidence. The edge decides nothing
 * about walls; it checks the file, forwards it with a bearer token that never reaches the browser, and checks the reply.
 */
export async function handleDrawingViews(
  request: Request,
  env: Env,
  send: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!env.DRAWING_WORKER_URL || !env.DRAWING_WORKER_TOKEN)
    return json({ error: "reading drawings is not set up on this server" }, 503);

  // Before the body is read or anything is forwarded: one caller cannot spend the worker's time, and neither can a crowd.
  const caller = request.headers.get("cf-connecting-ip") ?? "unknown";
  const [mine, everyone] = await Promise.all([
    env.DRAWING_LIMIT_CALLER?.limit({ key: caller }) ?? { success: true },
    env.DRAWING_LIMIT_ALL?.limit({ key: "all" }) ?? { success: true },
  ]);
  if (!mine.success || !everyone.success)
    return new Response(
      JSON.stringify({ error: "too many drawings just now; try again in a minute" }),
      {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "60" },
      },
    );

  const page = Number(new URL(request.url).searchParams.get("page") ?? "1");
  if (!Number.isInteger(page) || page < 1 || page > 50)
    return json({ error: "page must be 1 to 50" }, 400);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_PDF_BYTES) return json({ error: "that PDF is too large" }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_PDF_BYTES) return json({ error: "that PDF is too large" }, 413);
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
    return json({ error: "that is not a PDF" }, 400);

  let upstream: Response;
  try {
    upstream = await send(`${env.DRAWING_WORKER_URL}?page=${page}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.DRAWING_WORKER_TOKEN}`,
        "content-type": "application/pdf",
      },
      body: bytes,
    });
  } catch {
    return json({ error: "the drawing reader could not be reached" }, 502);
  }
  // The worker's own refusals (bad file) are the person's to hear; anything else is ours.
  if (upstream.status === 400) return json({ error: "that PDF could not be read" }, 422);
  if (!upstream.ok) return json({ error: "the drawing reader failed" }, 502);
  let raw: unknown;
  try {
    raw = await upstream.json();
  } catch {
    return json({ error: "the drawing reader sent something unexpected" }, 502);
  }
  const views = Views.safeParse(raw);
  if (!views.success) return json({ error: "the drawing reader sent something unexpected" }, 502);
  return json(views.data);
}
