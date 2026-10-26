import { describe, expect, it } from "vitest";
import { type AiBinding, EDIT_MODEL, handleRender, TEXT_MODEL } from "../src/render";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function fakeAi(result: unknown | Error) {
  const calls: { model: string; input: unknown }[] = [];
  const ai: AiBinding = {
    async run(model, input) {
      calls.push({ model, input });
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { ai, calls };
}
const post = (body: unknown) =>
  new Request("https://x/api/render", { method: "POST", body: JSON.stringify(body) });

describe("POST /api/render", () => {
  it("uses the text model without a reference and returns the picture", async () => {
    const { ai, calls } = fakeAi({ image: "AAAA" });
    const res = await handleRender(post({ prompt: "a bright office, warm oak" }), { AI: ai });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ image: "AAAA", model: TEXT_MODEL });
    expect(calls[0]?.model).toBe(TEXT_MODEL);
  });

  it("sends the reference to the edit model as multipart with its size", async () => {
    const { ai, calls } = fakeAi({ image: "BBBB" });
    const res = await handleRender(
      post({ prompt: "photograph this office", reference: PNG, width: 1024, height: 576, seed: 3 }),
      { AI: ai },
    );
    expect(res.status).toBe(200);
    expect(calls[0]?.model).toBe(EDIT_MODEL);
    const first = calls[0];
    if (!first) throw new Error("the model was not called");
    const { multipart } = first.input as {
      multipart: { body: ReadableStream; contentType: string };
    };
    expect(multipart.contentType).toMatch(/^multipart\/form-data; boundary=/);
    const text = await new Response(multipart.body, {
      headers: { "content-type": multipart.contentType },
    }).formData();
    expect(text.get("prompt")).toBe("photograph this office");
    expect(text.get("width")).toBe("1024");
    expect(text.get("seed")).toBe("3");
    expect(text.get("input_image_0")).toBeInstanceOf(Blob);
  });

  it("rejects bad input before calling the model", async () => {
    const { ai, calls } = fakeAi({ image: "x" });
    for (const body of [
      { prompt: "short" },
      { prompt: "a long enough prompt", width: 1000 },
      { prompt: "a long enough prompt", reference: "https://evil.example/x.png" },
      { prompt: "a long enough prompt", reference: "data:text/html;base64,AAAA" },
    ])
      expect((await handleRender(post(body), { AI: ai })).status).toBe(400);
    expect(
      (
        await handleRender(new Request("https://x/api/render", { method: "POST", body: "nope" }), {
          AI: ai,
        })
      ).status,
    ).toBe(400);
    expect((await handleRender(new Request("https://x/api/render"), { AI: ai })).status).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it("says plainly when the free allowance is used up, and hides internals otherwise", async () => {
    const limited = await handleRender(post({ prompt: "a bright office" }), {
      AI: fakeAi(new Error("daily neurons limit exceeded")).ai,
    });
    expect(limited.status).toBe(429);
    const broken = await handleRender(post({ prompt: "a bright office" }), {
      AI: fakeAi(new Error("stack trace with secrets")).ai,
    });
    expect(broken.status).toBe(502);
    expect(JSON.stringify(await broken.json())).not.toContain("secrets");
  });

  it("refuses a model reply with no image", async () => {
    const res = await handleRender(post({ prompt: "a bright office" }), { AI: fakeAi({}).ai });
    expect(res.status).toBe(502);
  });
});
