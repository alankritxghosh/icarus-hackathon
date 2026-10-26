import { PatchSchema, ProposalSchema } from "@icarus/core";
import { FakeMeta, MetaError } from "@icarus/meta";
import { describe, expect, it } from "vitest";
import { handlePropose, modelFromEnv } from "../src/design";
import type { AiBinding } from "../src/render";
import { FallbackMeta, WORKERS_AI_MODEL, WorkersAiMeta } from "../src/workersAi";

const PROPOSAL = {
  addRooms: ["lounge"],
  decisions: [{ topic: "lounge", choice: "add one", reason: "a place to reset" }],
};

function binding(result: unknown | Error) {
  const calls: { model: string; input: Record<string, unknown> }[] = [];
  const ai: AiBinding = {
    async run(model, input) {
      calls.push({ model, input: input as Record<string, unknown> });
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { ai, calls };
}

describe("WorkersAiMeta", () => {
  it("sends the rules as the system message and the schema, and validates the answer", async () => {
    const { ai, calls } = binding({ response: PROPOSAL });
    const out = await new WorkersAiMeta(ai).respond({
      instructions: "RULES",
      input: "BRIEF",
      schema: { name: "Proposal", type: ProposalSchema },
    });
    expect(out.parsed?.addRooms).toEqual(["lounge"]);
    expect(calls[0]?.model).toBe(WORKERS_AI_MODEL);
    expect(JSON.stringify(calls[0]?.input)).toContain("RULES");
    const first = calls[0];
    if (!first) throw new Error("the model was not called");
    expect((first.input.response_format as { type: string }).type).toBe("json_schema");
  });

  it("accepts the answer as text, even fenced, and refuses one outside the schema", async () => {
    const fenced = binding({
      response: `Here you go:\n\`\`\`json\n${JSON.stringify(PROPOSAL)}\n\`\`\``,
    });
    expect(
      (
        await new WorkersAiMeta(fenced.ai).respond({
          input: "x",
          schema: { name: "P", type: ProposalSchema },
        })
      ).parsed?.addRooms,
    ).toEqual(["lounge"]);
    const bad = binding({ response: { meetingRooms: 99 } });
    await expect(
      new WorkersAiMeta(bad.ai).respond({
        input: "x",
        schema: { name: "P", type: ProposalSchema },
      }),
    ).rejects.toMatchObject({ category: "invalid_response" });
    const empty = binding({});
    await expect(new WorkersAiMeta(empty.ai).respond({ input: "x" })).rejects.toMatchObject({
      category: "invalid_response",
    });
  });

  it("reports a used-up allowance as busy and hides other failures", async () => {
    await expect(
      new WorkersAiMeta(binding(new Error("neurons limit exceeded")).ai).respond({ input: "x" }),
    ).rejects.toMatchObject({ category: "rate_limited" });
    const err = await new WorkersAiMeta(binding(new Error("stack trace secrets")).ai)
      .respond({ input: "x" })
      .catch((e: MetaError) => e);
    expect(String((err as Error).message)).not.toContain("secrets");
  });
});

describe("FallbackMeta", () => {
  const route = (steps: ConstructorParameters<typeof FakeMeta>[0]) => new FakeMeta(steps);

  it("uses the primary when it works and records which route answered", async () => {
    const p = route([{ json: PROPOSAL }]);
    const s = route([{ json: { ...PROPOSAL, addRooms: ["storage"] } }]);
    const both = new FallbackMeta({ api: p, model: "primary" }, { api: s, model: "secondary" });
    const out = await both.respond({ input: "x", schema: { name: "P", type: ProposalSchema } });
    expect(out.parsed?.addRooms).toEqual(["lounge"]);
    expect(both.lastModel).toBe("primary");
    expect(s.requests).toHaveLength(0);
  });

  it("falls back when the primary is busy, down or out of allowance", async () => {
    for (const category of ["rate_limited", "network", "server", "timeout", "auth"] as const) {
      const p = route([{ error: new MetaError(category, "x") }]);
      const s = route([{ json: PROPOSAL }]);
      const both = new FallbackMeta({ api: p, model: "primary" }, { api: s, model: "secondary" });
      const out = await both.respond({ input: "x", schema: { name: "P", type: ProposalSchema } });
      expect(out.parsed?.addRooms, category).toEqual(["lounge"]);
      expect(both.lastModel, category).toBe("secondary");
    }
  });

  it("does not fall back on a wrong answer (that is asked again on the same route), and fails if both are down", async () => {
    const wrong = route([{ error: new MetaError("invalid_response", "mismatch") }]);
    const s = route([{ json: PROPOSAL }]);
    await expect(
      new FallbackMeta({ api: wrong, model: "p" }, { api: s, model: "s" }).respond({ input: "x" }),
    ).rejects.toMatchObject({ category: "invalid_response" });
    expect(s.requests).toHaveLength(0);
    const down1 = route([{ error: new MetaError("network", "x") }]);
    const down2 = route([{ error: new MetaError("network", "y") }]);
    await expect(
      new FallbackMeta({ api: down1, model: "p" }, { api: down2, model: "s" }).respond({
        input: "x",
      }),
    ).rejects.toMatchObject({ category: "network" });
  });
});

describe("modelFromEnv with the Workers AI binding", () => {
  const ai = binding({ response: PROPOSAL }).ai;

  it("works with no key at all, on the free Meta model", () => {
    expect(modelFromEnv({ AI: ai })()?.model()).toBe(WORKERS_AI_MODEL);
  });

  it("prefers OpenRouter when a key exists, and keeps Workers AI as the fallback", async () => {
    const found = modelFromEnv({ AI: ai, OPENROUTER_API_KEY: "sk-or-x" })();
    expect(found?.model()).toMatch(/laguna/);
    expect(found?.api).toBeInstanceOf(FallbackMeta);
  });

  it("answers a propose request from Workers AI alone", async () => {
    const req = new Request("https://x/api/design/propose", {
      method: "POST",
      body: JSON.stringify({
        brief: "A 20-person design studio. Windows on the south wall, entrance on the west.",
      }),
    });
    const res = await handlePropose(req, modelFromEnv({ AI: ai }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      model: WORKERS_AI_MODEL,
      proposal: { addRooms: ["lounge"] },
    });
  });

  it("is unchanged when there is neither a key nor a binding", () => {
    expect(modelFromEnv({})()).toBeUndefined();
    expect(PatchSchema).toBeDefined();
  });
});

describe("WorkersAiMeta and unsupported schema features", () => {
  it("asks again without the constraint when the decoder rejects the schema, and still validates", async () => {
    const calls: Record<string, unknown>[] = [];
    const ai: AiBinding = {
      async run(_model, input) {
        calls.push(input as Record<string, unknown>);
        if (calls.length === 1)
          throw new Error(
            '8007: {"error":{"message":"The provided JSON schema contains features not supported by xgrammar."}}',
          );
        return { response: JSON.stringify(PROPOSAL) };
      },
    };
    const out = await new WorkersAiMeta(ai).respond({
      input: "x",
      schema: { name: "P", type: ProposalSchema },
    });
    expect(out.parsed?.addRooms).toEqual(["lounge"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.response_format).toBeDefined();
    expect(calls[1]?.response_format).toBeUndefined();
    const stillBad: AiBinding = {
      async run(_m, input) {
        if ((input as Record<string, unknown>).response_format)
          throw new Error("not supported by xgrammar");
        return { response: JSON.stringify({ meetingRooms: 99 }) };
      },
    };
    await expect(
      new WorkersAiMeta(stillBad).respond({
        input: "x",
        schema: { name: "P", type: ProposalSchema },
      }),
    ).rejects.toMatchObject({ category: "invalid_response" });
  });
});
