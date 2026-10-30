import { describe, expect, it } from "vitest";
import { handleDrawingViews } from "../src/drawing";
import type { Env } from "../src/render";

const env: Env = {
  AI: { run: async () => ({}) },
  DRAWING_WORKER_URL: "https://worker.example/read",
  DRAWING_WORKER_TOKEN: "secret-token",
};
const pdf = () => new TextEncoder().encode("%PDF-1.4\nbody");
const post = (body: BodyInit, query = "") =>
  new Request(`https://x/api/drawing/views${query}`, { method: "POST", body });
const GOOD = { svg: "<svg/>", bboxHtml: "<doc/>", page: 1 };

const limiter = (allow: boolean, seen: string[] = []) => ({
  async limit({ key }: { key: string }) {
    seen.push(key);
    return { success: allow };
  },
});

describe("POST /api/drawing/views", () => {
  it("limits per caller and across everyone, before reading the file or calling the worker", async () => {
    let called = false;
    const never = (async () => {
      called = true;
      return Response.json(GOOD);
    }) as never;
    const keys: string[] = [];
    const req = () =>
      new Request("https://x/api/drawing/views", {
        method: "POST",
        body: pdf(),
        headers: { "cf-connecting-ip": "203.0.113.9" },
      });
    // A caller over their own limit.
    let res = await handleDrawingViews(
      req(),
      { ...env, DRAWING_LIMIT_CALLER: limiter(false, keys), DRAWING_LIMIT_ALL: limiter(true) },
      never,
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(keys).toEqual(["203.0.113.9"]);
    // Everyone over the shared limit.
    res = await handleDrawingViews(
      req(),
      { ...env, DRAWING_LIMIT_CALLER: limiter(true), DRAWING_LIMIT_ALL: limiter(false) },
      never,
    );
    expect(res.status).toBe(429);
    expect(called).toBe(false);
    // Both under their limits: the call goes through.
    res = await handleDrawingViews(
      req(),
      { ...env, DRAWING_LIMIT_CALLER: limiter(true), DRAWING_LIMIT_ALL: limiter(true) },
      (async () => Response.json(GOOD)) as never,
    );
    expect(res.status).toBe(200);
  });

  it("sends the PDF to the worker with the token and returns the validated views", async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const res = await handleDrawingViews(post(pdf(), "?page=2"), env, (async (
      url: string,
      init: RequestInit,
    ) => {
      seen.push({ url, init });
      return Response.json({ ...GOOD, page: 2 });
    }) as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...GOOD, page: 2 });
    expect(seen[0]?.url).toBe("https://worker.example/read?page=2");
    expect(((seen[0]?.init.headers ?? {}) as Record<string, string>).authorization).toBe(
      "Bearer secret-token",
    );
  });

  it("says it is not set up when the worker is not configured, and never calls out", async () => {
    let called = false;
    const res = await handleDrawingViews(post(pdf()), { AI: env.AI }, (async () => {
      called = true;
      return Response.json(GOOD);
    }) as never);
    expect(res.status).toBe(503);
    expect(called).toBe(false);
  });

  it("refuses wrong methods, other files, big files and bad pages before calling the worker", async () => {
    const never = (async () => Response.json(GOOD)) as never;
    expect(
      (await handleDrawingViews(new Request("https://x/api/drawing/views"), env, never)).status,
    ).toBe(405);
    expect((await handleDrawingViews(post("hello, not a pdf"), env, never)).status).toBe(400);
    expect((await handleDrawingViews(post(pdf(), "?page=0"), env, never)).status).toBe(400);
    const big = new Uint8Array(8 * 1024 * 1024 + 1);
    big.set(pdf());
    expect((await handleDrawingViews(post(big), env, never)).status).toBe(413);
  });

  it("maps the worker's failures without leaking its internals or the token", async () => {
    const run = (r: Response | Error) =>
      handleDrawingViews(post(pdf()), env, (async () => {
        if (r instanceof Error) throw r;
        return r;
      }) as never);
    expect((await run(new Response("bad", { status: 400 }))).status).toBe(422);
    expect((await run(new Response("boom secret-token", { status: 500 }))).status).toBe(502);
    expect((await run(new Error("connect secret-token"))).status).toBe(502);
    expect((await run(Response.json({ svg: 3 }))).status).toBe(502);
    const body = await (await run(new Response("boom secret-token", { status: 500 }))).text();
    expect(body).not.toContain("secret-token");
  });
});
