import { z } from "zod";
import type { Env } from "./env";

const MAX_GLB_BYTES = 60 * 1024 * 1024;
const MAX_JPEG_BASE64 = 4 * 1024 * 1024;
/** A Modal function-call id. */
const JOB = /^fc-[A-Za-z0-9]{8,64}$/;

const Vec = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]);
/** What the browser may ask for: its camera (which meters the exposure), the sun's direction and the sample count. */
const View = z.object({
  position: Vec,
  target: Vec,
  sun: Vec,
  fov: z.number().min(10).max(120),
  width: z.int().min(64).max(2400),
  height: z.int().min(64).max(2400),
  samples: z.int().min(16).max(1024),
  kind: z.literal("light"),
});
/** One light map per scene node id, each a JPEG; a building has a few hundred surfaces at most. */
const Baked = z.object({
  lightmaps: z
    .record(z.string().max(200), z.string().max(MAX_JPEG_BASE64))
    .refine((maps) => Object.keys(maps).length <= 2000, "too many surfaces"),
  range: z.number().positive().max(64),
  device: z.string().max(20),
  samples: z.int(),
  exposure: z.number(),
  importMs: z.int(),
  bakeMs: z.int(),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * POST /api/render with the model as a GLB body and the camera in the x-icarus-view header. Hands both to the Modal
 * render worker, which path traces the light falling on every floor, wall and ceiling with Blender Cycles on a GPU,
 * and returns one light map per surface. The edge decides
 * nothing about the model; it checks the file and the view, forwards them with a token the browser never sees, and
 * checks the reply.
 */
export async function handleRender(
  request: Request,
  env: Env,
  send: typeof fetch = fetch,
): Promise<Response> {
  if (request.method !== "POST" && request.method !== "GET")
    return json({ error: "method not allowed" }, 405);
  if (!env.RENDER_WORKER_URL || !env.RENDER_WORKER_TOKEN)
    return json({ error: "realistic rendering is not set up on this server" }, 503);
  if (request.method === "GET") return checkJob(request, env, send);

  // A GPU is paid by the second: one caller cannot queue renders, and neither can a crowd.
  const caller = request.headers.get("cf-connecting-ip") ?? "unknown";
  const [mine, everyone] = await Promise.all([
    env.RENDER_LIMIT_CALLER?.limit({ key: caller }) ?? { success: true },
    env.RENDER_LIMIT_ALL?.limit({ key: "all" }) ?? { success: true },
  ]);
  if (!mine.success || !everyone.success)
    return new Response(
      JSON.stringify({ error: "too many renders just now; try again in a minute" }),
      {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "60" },
      },
    );

  let view: z.infer<typeof View>;
  try {
    const parsed = View.safeParse(JSON.parse(request.headers.get("x-icarus-view") ?? ""));
    if (!parsed.success) return json({ error: "that view cannot be rendered" }, 400);
    view = parsed.data;
  } catch {
    return json({ error: "that view cannot be rendered" }, 400);
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_GLB_BYTES) return json({ error: "that model is too large to render" }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.length > MAX_GLB_BYTES)
    return json({ error: "that model is too large to render" }, 413);
  if (new TextDecoder().decode(bytes.slice(0, 4)) !== "glTF")
    return json({ error: "that is not a 3D model" }, 400);

  let upstream: Response;
  try {
    upstream = await send(env.RENDER_WORKER_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RENDER_WORKER_TOKEN}`,
        "content-type": "application/octet-stream",
        "x-icarus-view": JSON.stringify(view),
      },
      body: bytes,
    });
  } catch {
    return json({ error: "the renderer could not be reached" }, 502);
  }
  if (upstream.status === 400)
    return json({ error: "the renderer could not read that model" }, 422);
  if (!upstream.ok) return json({ error: "the renderer failed" }, 502);
  const started = Started.safeParse(await upstream.json().catch(() => null));
  if (!started.success) return json({ error: "the renderer sent something unexpected" }, 502);
  return json(started.data, 202);
}

const Started = z.object({ job: z.string().regex(JOB) });

/** GET /api/render?job=<id>: 202 while the bake runs, then the light maps. Polling costs no GPU, so it is not limited. */
async function checkJob(request: Request, env: Env, send: typeof fetch): Promise<Response> {
  const job = new URL(request.url).searchParams.get("job") ?? "";
  if (!JOB.test(job)) return json({ error: "no such bake" }, 400);
  let upstream: Response;
  try {
    upstream = await send(`${(env.RENDER_WORKER_URL ?? "").replace(/\/$/, "")}/jobs/${job}`, {
      headers: { authorization: `Bearer ${env.RENDER_WORKER_TOKEN}` },
    });
  } catch {
    return json({ error: "the renderer could not be reached" }, 502);
  }
  if (upstream.status === 202) return json({ pending: true }, 202);
  if (upstream.status === 400)
    return json({ error: "the renderer could not read that model" }, 422);
  if (!upstream.ok) return json({ error: "the renderer failed" }, 502);
  const baked = Baked.safeParse(await upstream.json().catch(() => null));
  if (!baked.success) return json({ error: "the renderer sent something unexpected" }, 502);
  return json(baked.data);
}
