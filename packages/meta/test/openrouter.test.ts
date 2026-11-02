import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildImageBody,
  defineTool,
  FakeImages,
  FakeMeta,
  imageClientFromEnv,
  type MetaError,
  metaClientFromEnv,
  OpenRouterImages,
  readImages,
  runToolLoop,
} from "../src";

const KEY = "sk-or-test-secret-999";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function capture(response: Response) {
  const seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] =
    [];
  const fetch = async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(url),
      headers: init?.headers as Record<string, string>,
      body: JSON.parse(String(init?.body)),
    });
    return response.clone();
  };
  return { seen, fetch: fetch as typeof globalThis.fetch };
}

describe("provider selection", () => {
  it("uses OpenRouter, statelessly, when OPENROUTER_API_KEY is set", () => {
    const client = metaClientFromEnv({
      OPENROUTER_API_KEY: KEY,
      ICARUS_MODEL: "meta/muse-spark-1.3",
    });
    expect(client.provider).toBe("openrouter");
    expect(client.stateless).toBe(true);
    expect(client.model).toBe("meta/muse-spark-1.3");
  });

  it("defaults OpenRouter to a free development model and Meta to Muse Spark", () => {
    expect(metaClientFromEnv({ OPENROUTER_API_KEY: KEY }).model).toMatch(/:free$/);
    const meta = metaClientFromEnv({ MODEL_API_KEY: KEY });
    expect([meta.provider, meta.stateless, meta.model]).toEqual(["meta", false, "muse-spark-1.3"]);
  });

  it("names the missing variable, never the value", () => {
    expect(() => metaClientFromEnv({ OPENROUTER_API_KEY: "  " })).toThrow(/MODEL_API_KEY/);
    const err = (() => {
      try {
        imageClientFromEnv({});
      } catch (e) {
        return e as MetaError;
      }
    })();
    expect(err?.message).toBe("OPENROUTER_API_KEY is not set");
  });

  it("sends the configured model to the OpenRouter endpoint and refuses previousResponseId", async () => {
    const { seen, fetch } = capture(
      json({
        id: "r1",
        status: "completed",
        output: [
          { type: "message", role: "assistant", content: [{ type: "output_text", text: "hi" }] },
        ],
      }),
    );
    const client = metaClientFromEnv(
      { OPENROUTER_API_KEY: KEY, ICARUS_MODEL: "meta/muse-spark-1.3" },
      { fetch },
    );
    await client.respond({ input: "hello" });
    expect(seen[0]?.url).toBe("https://openrouter.ai/api/v1/responses");
    expect(seen[0]?.body.model).toBe("meta/muse-spark-1.3");
    await expect(client.respond({ input: "x", previousResponseId: "r1" })).rejects.toMatchObject({
      category: "invalid_request",
    });
  });

  it("says plainly that SAM is not available through OpenRouter", async () => {
    const client = metaClientFromEnv({ OPENROUTER_API_KEY: KEY });
    await expect(client.segment({ image: "data:", phrase: "chair" })).rejects.toThrow(
      /not available through OpenRouter/,
    );
  });
});

describe("the tool loop on a stateless provider", () => {
  it("resends the whole history, with each call followed by its output", async () => {
    const fake = new FakeMeta([
      { toolCalls: [{ name: "add", arguments: { a: 2, b: 3 } }] },
      { text: "The sum is 5." },
    ]);
    fake.stateless = true;
    const out = await runToolLoop(fake, {
      instructions: "Add numbers.",
      input: "What is 2 + 3?",
      tools: [
        defineTool({
          name: "add",
          description: "Add two numbers.",
          parameters: z.object({ a: z.number(), b: z.number() }),
          run: (args: { a: number; b: number }) => args.a + args.b,
        }),
      ],
    });
    expect(out.text).toBe("The sum is 5.");
    const second = fake.requests[1];
    expect(second?.previousResponseId).toBeUndefined();
    const items = second?.input as { type: string }[];
    expect(items.map((i) => i.type)).toEqual(["message", "function_call", "function_call_output"]);
  });
});

describe("images", () => {
  it("builds an image-to-image request from references", () => {
    const body = buildImageBody(
      {
        prompt: "photograph this room",
        references: ["data:image/png;base64,AAAA"],
        aspectRatio: "16:9",
        seed: 7,
      },
      "black-forest-labs/flux.2-klein-4b",
    );
    expect(body).toEqual({
      model: "black-forest-labs/flux.2-klein-4b",
      prompt: "photograph this room",
      n: 1,
      aspect_ratio: "16:9",
      seed: 7,
      input_references: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }],
    });
  });

  it("reads the picture and its cost, and refuses an empty body", () => {
    expect(
      readImages({
        created: 1,
        data: [{ b64_json: "AAAA", media_type: "image/jpeg" }],
        usage: { cost: 0.014 },
      }),
    ).toEqual({
      images: [{ base64: "AAAA", mediaType: "image/jpeg" }],
      costUsd: 0.014,
    });
    expect(() => readImages({ data: [] })).toThrow(/generated image/);
    expect(() => readImages({ error: "x" })).toThrow(/generated image/);
  });

  it("posts to /images with the key in the header only", async () => {
    const { seen, fetch } = capture(json({ data: [{ b64_json: "AAAA" }] }));
    const client = new OpenRouterImages({
      apiKey: KEY,
      baseUrl: "https://openrouter.ai/api/v1",
      fetch,
    });
    const result = await client.generate({ prompt: "a room" });
    expect(seen[0]?.url).toBe("https://openrouter.ai/api/v1/images");
    expect(seen[0]?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.stringify(seen[0]?.body)).not.toContain(KEY);
    expect(result.images[0]?.mediaType).toBe("image/png");
  });

  it("the fake refuses an unscripted call", async () => {
    await expect(new FakeImages().generate({ prompt: "x" })).rejects.toThrow(/unscripted/);
  });
});

describe("fetch is called as a bare function", () => {
  it("never invokes the underlying fetch as a method of the transport, which Workers and browsers reject", async () => {
    let receiver: unknown = "unset";
    const strictFetch = function (this: unknown): Promise<Response> {
      receiver = this;
      return Promise.resolve(json({ id: "r", status: "completed", output: [] }));
    };
    const client = metaClientFromEnv(
      { OPENROUTER_API_KEY: "sk-or-test" },
      { fetch: strictFetch as never },
    );
    await client.respond({ input: "hello" });
    expect(receiver === undefined || receiver === globalThis).toBe(true);
  });
});

describe("reasoning effort", () => {
  it("is sent to OpenRouter and to the Meta API as reasoning.effort", async () => {
    const reply = () =>
      json({
        id: "r",
        status: "completed",
        output: [
          { type: "message", role: "assistant", content: [{ type: "output_text", text: "hi" }] },
        ],
      });
    const viaOpenRouter = capture(reply());
    await metaClientFromEnv({ OPENROUTER_API_KEY: KEY }, { fetch: viaOpenRouter.fetch }).respond({
      input: "x",
      reasoningEffort: "low",
    });
    expect(viaOpenRouter.seen[0]?.body.reasoning).toEqual({ effort: "low" });
    const viaMeta = capture(reply());
    await metaClientFromEnv({ MODEL_API_KEY: KEY }, { fetch: viaMeta.fetch }).respond({
      input: "x",
      reasoningEffort: "low",
    });
    expect(viaMeta.seen[0]?.body.reasoning).toEqual({ effort: "low" });
  });
});

describe("extractJson", () => {
  it("takes the JSON object out of a fence or a sentence, and leaves clean JSON alone", async () => {
    const { extractJson } = await import("../src/responses");
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('Sure! Here you go: {"a":{"b":[1,2]}} Hope that helps.')).toBe(
      '{"a":{"b":[1,2]}}',
    );
    expect(extractJson('{"note":"a } brace in a string","n":2} trailing')).toBe(
      '{"note":"a } brace in a string","n":2}',
    );
    expect(extractJson('{"q":"he said \\"hi\\" {"}')).toBe('{"q":"he said \\"hi\\" {"}');
    expect(extractJson("no json at all")).toBe("no json at all");
  });
});
