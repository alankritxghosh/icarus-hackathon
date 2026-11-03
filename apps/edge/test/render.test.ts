import { describe, expect, it } from "vitest";
import type { Env } from "../src/env";
import { handleRender } from "../src/render";

const env: Env = {
  AI: { run: async () => ({}) },
  RENDER_WORKER_URL: "https://worker.example/draw",
  RENDER_WORKER_TOKEN: "render-secret",
};
const VIEW = {
  position: [30, 20, 30],
  target: [12, 1, 6],
  sun: [-19, 25, 19],
  fov: 38,
  width: 1280,
  height: 800,
  samples: 128,
  kind: "light",
};
const glb = () => new TextEncoder().encode("glTF\u0002\u0000\u0000\u0000body");
const post = (body: BodyInit, view: unknown = VIEW, ip = "203.0.113.9") =>
  new Request("https://x/api/render", {
    method: "POST",
    body,
    headers: { "x-icarus-view": JSON.stringify(view), "cf-connecting-ip": ip },
  });
const GOOD = {
  lightmaps: { "floor.open_workspace.1": "/9j/AA==", "wall.0": "/9j/AA==" },
  range: 4,
  device: "OPTIX",
  samples: 128,
  exposure: 0.4,
  importMs: 1500,
  bakeMs: 60000,
};
const limiter = (allow: boolean) => ({ limit: async () => ({ success: allow }) });

describe("POST /api/render", () => {
  it("forwards the model and the checked view with the token, and returns the light maps", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const send = (async (url: string, init: RequestInit) => {
      seen.push({ url, init });
      return Response.json(GOOD);
    }) as never;
    const res = await handleRender(post(glb()), env, send);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(GOOD);
    expect(seen[0]?.url).toBe("https://worker.example/draw");
    const headers = seen[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer render-secret");
    expect(JSON.parse(headers["x-icarus-view"] as string)).toEqual(VIEW);
  });

  it("limits before reading the model or calling the GPU", async () => {
    let called = false;
    const never = (async () => {
      called = true;
      return Response.json(GOOD);
    }) as never;
    const res = await handleRender(
      post(glb()),
      { ...env, RENDER_LIMIT_CALLER: limiter(false), RENDER_LIMIT_ALL: limiter(true) },
      never,
    );
    expect(res.status).toBe(429);
    expect(called).toBe(false);
  });

  it("refuses a missing set-up, a bad view, a file that is not a model, and an odd reply", async () => {
    const never = (async () => {
      throw new Error("must not be called");
    }) as never;
    expect((await handleRender(post(glb()), { AI: env.AI }, never)).status).toBe(503);
    expect((await handleRender(post(glb(), { ...VIEW, width: 9000 }), env, never)).status).toBe(
      400,
    );
    expect((await handleRender(post(glb(), "not json"), env, never)).status).toBe(400);
    expect((await handleRender(post(new TextEncoder().encode("%PDF-")), env, never)).status).toBe(
      400,
    );
    const odd = (async () => Response.json({ image: "x" })) as never;
    expect((await handleRender(post(glb()), env, odd)).status).toBe(502);
    const refused = (async () => new Response("bad", { status: 400 })) as never;
    expect((await handleRender(post(glb()), env, refused)).status).toBe(422);
  });
});
