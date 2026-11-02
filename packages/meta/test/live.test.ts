import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineTool, metaClientFromEnv, runToolLoop } from "../src";

/**
 * Real calls to the Meta Model API. Skipped unless MODEL_API_KEY or OPENROUTER_API_KEY is set, so CI and fresh clones
 * pass without credentials. Each call is tiny; this confirms the documented wire formats the
 * contract tests assume.
 */
const live = process.env.MODEL_API_KEY || process.env.OPENROUTER_API_KEY ? describe : describe.skip;

live("Meta Model API (live)", () => {
  // Built lazily: a skipped suite still runs its body while tests are collected, and there may be no key.
  const client = () => metaClientFromEnv(process.env);

  it("returns schema-constrained JSON from Muse Spark", { timeout: 60_000 }, async () => {
    const result = await client().respond({
      input: "A steel shaft is 25 millimetres in diameter and 130 millimetres long. Extract it.",
      schema: { name: "Shaft", type: z.object({ diameterMm: z.number(), lengthMm: z.number() }) },
      reasoningEffort: "low",
    });
    expect(result.parsed).toEqual({ diameterMm: 25, lengthMm: 130 });
    expect(result.usage.inputTokens).toBeGreaterThan(0);
  });

  it("calls a tool with valid arguments and finishes the turn", { timeout: 90_000 }, async () => {
    const seen: unknown[] = [];
    const out = await runToolLoop(client(), {
      instructions:
        "Use the tool to apply the change the user asks for, then say what you did in one sentence.",
      input: "Set the shaft diameter to 30 millimetres.",
      tools: [
        defineTool({
          name: "set_parameter",
          description: "Set a named design parameter in millimetres.",
          parameters: z.object({
            id: z.enum(["shaft_d", "shaft_len"]),
            valueMm: z.number().positive(),
          }),
          run: (args: { id: string; valueMm: number }) => {
            seen.push(args);
            return { ok: true };
          },
        }),
      ],
    });
    expect(seen).toEqual([{ id: "shaft_d", valueMm: 30 }]);
    expect(out.stopped).toBe("done");
  });
});
