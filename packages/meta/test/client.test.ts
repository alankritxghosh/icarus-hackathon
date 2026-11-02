import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  defineTool,
  FakeMeta,
  locateBoxes,
  locatePoints,
  MetaClient,
  type MetaError,
  parseSegmentation,
  runToolLoop,
} from "../src";

const KEY = "sk-test-secret-key-123";
const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
const message = (text: string) => ({
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text }],
});
const ok = (output: unknown[], id = "resp_1") =>
  reply({ id, status: "completed", output, usage: { input_tokens: 11, output_tokens: 7 } });

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function first<T>(items: T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error("nothing was captured");
  return item;
}

function scripted(...responses: (Response | Error)[]) {
  const seen: Seen[] = [];
  const queue = [...responses];
  const sleeps: number[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    seen.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)),
    });
    const next = queue.shift();
    if (!next) throw new Error("unscripted fetch");
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  const client = new MetaClient({
    apiKey: KEY,
    fetch: fetchFn,
    sleep: async (ms) => void sleeps.push(ms),
    random: () => 0,
  });
  return { client, seen, sleeps };
}

const Spec = z.object({
  parts: z.array(z.object({ id: z.string(), diameterMm: z.number().positive() })),
});

describe("MetaClient requests", () => {
  it("posts the documented Responses shape with bearer auth", async () => {
    const { client, seen } = scripted(ok([message('{"parts":[{"id":"shaft","diameterMm":25}]}')]));
    const result = await client.respond({
      instructions: "Extract a design.",
      input: [
        { type: "message", role: "user", content: [{ type: "input_text", text: "a 25 mm shaft" }] },
      ],
      schema: { name: "DesignSpec", type: Spec },
    });
    expect(seen[0]?.url).toBe("https://api.meta.ai/v1/responses");
    expect(seen[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(seen[0]?.body.model).toBe("muse-spark-1.3");
    expect(seen[0]?.body.instructions).toBe("Extract a design.");
    const format = (
      first(seen).body.text as {
        format: { type: string; name: string; schema: Record<string, unknown> };
      }
    ).format;
    expect(format.type).toBe("json_schema");
    expect(format.name).toBe("DesignSpec");
    expect(format.schema.type).toBe("object");
    expect(format.schema.$schema).toBeUndefined();
    expect(result.parsed).toEqual({ parts: [{ id: "shaft", diameterMm: 25 }] });
    expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 7 });
  });

  it("declares tools in the flat format and reads function_call items", async () => {
    const { client, seen } = scripted(
      ok([
        {
          type: "function_call",
          name: "set_parameter",
          arguments: '{"id":"shaft_d","value":30}',
          call_id: "call_9",
        },
      ]),
    );
    const result = await client.respond({
      input: "make the shaft 30 mm",
      tools: [
        {
          name: "set_parameter",
          description: "Set a parameter",
          parameters: z.object({ id: z.string(), value: z.number() }),
        },
      ],
    });
    const tool = first(first(seen).body.tools as Record<string, unknown>[]);
    expect(tool).toMatchObject({
      type: "function",
      name: "set_parameter",
      description: "Set a parameter",
    });
    expect(tool.function).toBeUndefined();
    expect((tool.parameters as { properties: object }).properties).toHaveProperty("value");
    expect(result.toolCalls).toEqual([
      { callId: "call_9", name: "set_parameter", arguments: '{"id":"shaft_d","value":30}' },
    ]);
  });

  it("sends a discriminated union as one flat object and reads the chosen branch back", async () => {
    const Op = z.object({
      ops: z.array(
        z.discriminatedUnion("op", [
          z.object({ op: z.literal("move"), room: z.string() }),
          z.object({ op: z.literal("add"), count: z.number() }),
        ]),
      ),
    });
    const { client, seen } = scripted(ok([message('{"ops":[{"op":"add","room":"","count":2}]}')]));
    const result = await client.respond({ input: "x", schema: { name: "Ops", type: Op } });
    const format = (first(seen).body.text as { format: { schema: Record<string, unknown> } }).format
      .schema;
    const sent = JSON.stringify(format);
    // Meta keeps only the first branch of a union, so no union is sent at all.
    expect(sent).not.toMatch(/"(anyOf|oneOf)"/);
    const op = (format.properties as { ops: { items: Record<string, unknown> } }).ops.items;
    expect(op.required).toEqual(["op", "room", "count"]);
    expect((op.properties as { op: { enum: string[] } }).op.enum).toEqual(["move", "add"]);
    // The filler for the field the chosen branch lacks is dropped before validation.
    expect(result.parsed).toEqual({ ops: [{ op: "add", count: 2 }] });
  });

  it("rejects output that does not satisfy the schema, even though decoding was guided", async () => {
    const { client } = scripted(ok([message('{"parts":[{"id":"shaft","diameterMm":-3}]}')]));
    await expect(
      client.respond({ input: "x", schema: { name: "DesignSpec", type: Spec } }),
    ).rejects.toMatchObject({
      category: "invalid_response",
      message: expect.stringContaining("failed validation"),
    });
    const notJson = scripted(ok([message("sure, here you go")]));
    await expect(
      notJson.client.respond({ input: "x", schema: { name: "DesignSpec", type: Spec } }),
    ).rejects.toMatchObject({ category: "invalid_response" });
  });

  it("refuses incomplete and failed responses", async () => {
    const incomplete = scripted(
      reply({
        id: "r",
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
        output: [],
      }),
    );
    await expect(incomplete.client.respond({ input: "x" })).rejects.toThrow(
      /incomplete \(max_output_tokens\)/,
    );
    const failed = scripted(
      reply({ id: "r", status: "failed", error: { message: "boom" }, output: [] }),
      reply({ id: "r", status: "failed", error: { message: "boom" }, output: [] }),
      reply({ id: "r", status: "failed", error: { message: "boom" }, output: [] }),
    );
    await expect(failed.client.respond({ input: "x" })).rejects.toMatchObject({
      category: "server",
    });
  });
});

describe("MetaClient reliability and safety", () => {
  it("retries rate limits honouring Retry-After, then succeeds", async () => {
    const { client, seen, sleeps } = scripted(
      reply({ error: { message: "slow down" } }, 429, { "retry-after": "2" }),
      ok([message("hi")]),
    );
    expect((await client.respond({ input: "x" })).text).toBe("hi");
    expect(seen).toHaveLength(2);
    expect(sleeps).toEqual([2000]);
  });

  it("backs off exponentially on server errors and gives up after the retry budget", async () => {
    const { client, seen, sleeps } = scripted(
      reply("", 503),
      reply("", 502),
      reply("", 500),
      reply("", 500),
    );
    await expect(client.respond({ input: "x" })).rejects.toMatchObject({
      category: "server",
      status: 500,
    });
    expect(seen).toHaveLength(4);
    expect(sleeps).toEqual([500, 1000, 2000]);
  });

  it("does not retry client errors or auth failures", async () => {
    const bad = scripted(reply({ error: { message: "schema too deep" } }, 400));
    await expect(bad.client.respond({ input: "x" })).rejects.toMatchObject({
      category: "invalid_request",
      status: 400,
      message: expect.stringContaining("schema too deep"),
    });
    expect(bad.seen).toHaveLength(1);
    const auth = scripted(reply({ error: { message: `invalid key ${KEY}` } }, 401));
    const error = await auth.client.respond({ input: "x" }).catch((e: MetaError) => e);
    expect(error).toMatchObject({ category: "auth" });
    expect(auth.seen).toHaveLength(1);
    expect(String((error as MetaError).message)).not.toContain(KEY);
  });

  it("classifies timeouts and network failures as retryable", async () => {
    const timeout = Object.assign(new Error("t"), { name: "TimeoutError" });
    const a = scripted(timeout, ok([message("ok")]));
    expect((await a.client.respond({ input: "x" })).text).toBe("ok");
    const b = scripted(
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
    );
    await expect(b.client.respond({ input: "x" })).rejects.toMatchObject({
      category: "network",
      retryable: true,
    });
  });

  it("never puts the key in the request body, and fails before any request when it is missing", async () => {
    const { client, seen } = scripted(ok([message("hi")]));
    await client.respond({ input: "x" });
    expect(JSON.stringify(seen[0]?.body)).not.toContain(KEY);
    expect(() => new MetaClient({ apiKey: "  " })).toThrow(/MODEL_API_KEY/);
  });
});

describe("segmentation", () => {
  const line =
    "<0f>0<|box;x1=444;y1=626;x2=675;y2=849;w=1800;h=1200;c=0.91|><|mask;x=0;y=0;c=0.91;data=37,51,!AbC~d|>,2<|box;x1=10;y1=20;x2=30;y2=40;w=1800;h=1200;c=0.5|><|mask;x=0;y=0;c=0.5;data=4,5,~xyz|>";

  it("reads boxes, confidence and mask metadata, including a payload containing ~ and !", () => {
    const matches = parseSegmentation(line);
    expect(matches).toHaveLength(2);
    expect(matches[0]).toEqual({
      frame: 0,
      id: 0,
      box: { x1: 444, y1: 626, x2: 675, y2: 849, w: 1800, h: 1200 },
      confidence: 0.91,
      mask: { rows: 37, cols: 51, encoding: "one_bit", payload: "AbC~d" },
    });
    expect(matches[1]).toMatchObject({
      id: 2,
      mask: { rows: 4, cols: 5, encoding: "lossless", payload: "xyz" },
    });
  });

  it("treats empty output as no matches and unreadable output as an error", () => {
    expect(parseSegmentation("")).toEqual([]);
    expect(() => parseSegmentation("I could not find that")).toThrow(/no frame marker/);
    expect(() => parseSegmentation("<0f>garbage")).toThrow(/no readable records/);
  });

  it("sends the phrase and image to sam-3.1 and asks for confidence and one-bit masks", async () => {
    const { client, seen } = scripted(ok([message(line)]));
    const matches = await client.segment({ image: "data:image/png;base64,AAAA", phrase: "desk" });
    expect(matches).toHaveLength(2);
    expect(seen[0]?.body.model).toBe("sam-3.1");
    expect(seen[0]?.body.metadata).toEqual({
      include_confidence: "true",
      mask_encoding: "one_bit",
    });
    const content = (
      (first(seen).body.input as { content: Record<string, string>[] }[])[0] as {
        content: Record<string, string>[];
      }
    ).content;
    expect(content[0]).toEqual({ type: "input_text", text: "desk" });
    expect(content[1]).toMatchObject({
      type: "input_image",
      image_url: "data:image/png;base64,AAAA",
    });
  });
});

describe("grounding", () => {
  it("converts the 0-1000 grid to unit coordinates, drops unrequested labels, and reports what was not found", async () => {
    const fake = new FakeMeta([
      {
        json: {
          items: [
            { label: "shaft", x: 500, y: 250 },
            { label: "stranger", x: 1, y: 1 },
          ],
        },
      },
    ]);
    const out = await locatePoints(fake, {
      image: "data:image/png;base64,AAAA",
      labels: ["shaft", "housing"],
    });
    expect(out.found).toEqual([{ label: "shaft", x: 0.5, y: 0.25 }]);
    expect(out.missing).toEqual(["housing"]);
  });

  it("rejects coordinates outside the grid and discards degenerate boxes", async () => {
    await expect(
      locatePoints(new FakeMeta([{ json: { items: [{ label: "a", x: 1200, y: 5 }] } }]), {
        image: "i",
        labels: ["a"],
      }),
    ).rejects.toMatchObject({ category: "invalid_response" });
    const out = await locateBoxes(
      new FakeMeta([
        {
          json: {
            items: [
              { label: "a", x_min: 100, y_min: 200, x_max: 300, y_max: 600 },
              { label: "b", x_min: 50, y_min: 50, x_max: 50, y_max: 90 },
            ],
          },
        },
      ]),
      { image: "i", labels: ["a", "b"] },
    );
    expect(out.found).toEqual([{ label: "a", x1: 0.1, y1: 0.2, x2: 0.3, y2: 0.6 }]);
    expect(out.missing).toEqual(["b"]);
  });
});

describe("tool loop", () => {
  const applied: unknown[] = [];
  const setParameter = defineTool({
    name: "set_parameter",
    description: "Set a parameter",
    parameters: z.object({ id: z.string(), value: z.number().positive() }),
    run: (args: { id: string; value: number }) => {
      if (args.id === "locked") throw new Error("parameter is locked");
      applied.push(args);
      return { ok: true, ...args };
    },
  });

  it("runs validated calls, threads previous_response_id and pairs outputs with call ids", async () => {
    applied.length = 0;
    const fake = new FakeMeta([
      { toolCalls: [{ name: "set_parameter", arguments: { id: "shaft_d", value: 30 } }] },
      { text: "Done: shaft is 30 mm." },
    ]);
    const out = await runToolLoop(fake, {
      instructions: "Revise",
      input: "make the shaft 30 mm",
      tools: [setParameter],
    });
    expect(out).toMatchObject({ stopped: "done", turns: 2, text: "Done: shaft is 30 mm." });
    expect(applied).toEqual([{ id: "shaft_d", value: 30 }]);
    expect(fake.requests[1]?.previousResponseId).toBe("resp_fake_1");
    expect(fake.requests[1]?.instructions).toBe("Revise");
    expect(fake.requests[1]?.input).toEqual([
      {
        type: "function_call_output",
        call_id: "call_1_0",
        output: '{"ok":true,"id":"shaft_d","value":30}',
      },
    ]);
    expect(fake.requests[1]?.tools).toHaveLength(1);
  });

  it("returns invalid arguments, unknown tools and tool errors to the model instead of running or hiding them", async () => {
    applied.length = 0;
    const fake = new FakeMeta([
      {
        toolCalls: [
          { name: "set_parameter", arguments: { id: "shaft_d", value: -5 } },
          { name: "launch_missiles", arguments: {} },
          { name: "set_parameter", arguments: { id: "locked", value: 5 } },
        ],
      },
      { text: "I could not apply those." },
    ]);
    const out = await runToolLoop(fake, {
      instructions: "Revise",
      input: "x",
      tools: [setParameter],
    });
    expect(applied).toEqual([]);
    expect(out.calls.map((c) => c.ok)).toEqual([false, false, false]);
    expect(out.calls[0]?.output).toMatch(/invalid arguments/);
    expect(out.calls[1]?.output).toMatch(/unknown tool/);
    expect(out.calls[2]?.output).toMatch(/parameter is locked/);
  });

  it("stops at the turn limit instead of looping forever", async () => {
    const again = { toolCalls: [{ name: "set_parameter", arguments: { id: "a", value: 1 } }] };
    const fake = new FakeMeta([again, again, again]);
    const out = await runToolLoop(fake, {
      instructions: "Revise",
      input: "x",
      tools: [setParameter],
      maxTurns: 3,
    });
    expect(out).toMatchObject({ stopped: "max_turns", turns: 3 });
  });
});

describe("FakeMeta", () => {
  it("fails loudly when a call is not scripted and validates scripted output like the real client", async () => {
    await expect(new FakeMeta().respond({ input: "x" })).rejects.toThrow(/unscripted/);
    const fake = new FakeMeta([{ json: { parts: [{ id: "s", diameterMm: -1 }] } }]);
    await expect(
      fake.respond({ input: "x", schema: { name: "DesignSpec", type: Spec } }),
    ).rejects.toMatchObject({ category: "invalid_response" });
  });
});
