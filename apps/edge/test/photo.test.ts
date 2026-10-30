import { describe, expect, it } from "vitest";
import type { AiBinding } from "../src/env";
import { handleReadPhoto, VISION_MODEL } from "../src/photo";

const PNG = "data:image/png;base64,iVBORw0KGgo=";
const GOOD = {
  spaceKind: "open_plan",
  seatsVisible: 6,
  estimatedHeadcount: 14,
  zones: ["open_workspace", "lounge"],
  windows: "some",
  ceiling: "high_exposed",
  floor: "oak",
  accentColor: "#333333",
  wallColor: "#ffffff",
  mood: "modern workspace",
  notes: [],
};

function ai(result: unknown | Error) {
  const calls: { model: string; input: unknown }[] = [];
  const binding: AiBinding = {
    async run(model, input) {
      calls.push({ model, input });
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { binding, calls };
}
const post = (body: unknown) =>
  new Request("https://x/api/read-photo", { method: "POST", body: JSON.stringify(body) });

describe("POST /api/read-photo", () => {
  it("returns a validated reading whether the model sends an object or text", async () => {
    for (const response of [GOOD, JSON.stringify(GOOD)]) {
      const { binding, calls } = ai({ response });
      const res = await handleReadPhoto(post({ image: PNG }), { AI: binding });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ read: { floor: "oak" }, model: VISION_MODEL });
      expect(calls[0]?.model).toBe(VISION_MODEL);
    }
  });

  it("sends the schema and the rules with the image", async () => {
    const { binding, calls } = ai({ response: GOOD });
    await handleReadPhoto(post({ image: PNG }), { AI: binding });
    const input = calls[0]?.input as {
      messages: { content: unknown }[];
      response_format: { type: string };
    };
    expect(input.response_format.type).toBe("json_schema");
    expect(JSON.stringify(input.messages)).toContain("seatsVisible");
    expect(JSON.stringify(input.messages)).toContain(PNG);
  });

  it("refuses a reading that does not match the schema, without leaking it", async () => {
    const { binding } = ai({ response: { ...GOOD, floor: "marble", secret: "internal" } });
    const res = await handleReadPhoto(post({ image: PNG }), { AI: binding });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("marble");
  });

  it("rejects bad input before calling the model", async () => {
    const { binding, calls } = ai({ response: GOOD });
    for (const body of [
      {},
      { image: "https://evil.example/x.png" },
      { image: "data:text/html;base64,AAAA" },
    ])
      expect((await handleReadPhoto(post(body), { AI: binding })).status).toBe(400);
    expect(
      (await handleReadPhoto(new Request("https://x/api/read-photo"), { AI: binding })).status,
    ).toBe(405);
    expect(calls).toHaveLength(0);
  });

  it("reports a used-up allowance plainly and hides other failures", async () => {
    const limited = await handleReadPhoto(post({ image: PNG }), {
      AI: ai(new Error("neurons limit")).binding,
    });
    expect(limited.status).toBe(429);
    const broken = await handleReadPhoto(post({ image: PNG }), {
      AI: ai(new Error("stack trace")).binding,
    });
    expect(broken.status).toBe(502);
    expect(JSON.stringify(await broken.json())).not.toContain("stack");
  });
});
