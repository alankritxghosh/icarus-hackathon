import { describe, expect, it } from "vitest";
import {
  BudgetedMeta,
  limitsFromEnv,
  type MetaApi,
  MetaError,
  memoryStore,
  metaClientFromEnv,
  providerFromEnv,
  type RespondResult,
} from "../src";

const KEY = "test-key-not-real";

describe("choosing the provider", () => {
  it("ICARUS_PROVIDER decides even when both keys are present", () => {
    const both = { OPENROUTER_API_KEY: KEY, MODEL_API_KEY: KEY };
    expect(providerFromEnv({ ...both, ICARUS_PROVIDER: "meta" })).toBe("meta");
    expect(providerFromEnv({ ...both, ICARUS_PROVIDER: "OpenRouter" })).toBe("openrouter");
    const meta = metaClientFromEnv({ ...both, ICARUS_PROVIDER: "meta" });
    expect([meta.provider, meta.model, meta.stateless]).toEqual(["meta", "muse-spark-1.3", false]);
    expect(metaClientFromEnv({ ...both, ICARUS_PROVIDER: "openrouter" }).provider).toBe(
      "openrouter",
    );
  });

  it("keeps the old behaviour without it, and rejects a typo", () => {
    expect(providerFromEnv({ OPENROUTER_API_KEY: KEY, MODEL_API_KEY: KEY })).toBe("openrouter");
    expect(providerFromEnv({ MODEL_API_KEY: KEY })).toBe("meta");
    expect(() => providerFromEnv({ ICARUS_PROVIDER: "metta" })).toThrow(/ICARUS_PROVIDER/);
  });

  it("asking for Meta without its key names the missing variable, not a value", () => {
    expect(() => metaClientFromEnv({ OPENROUTER_API_KEY: KEY, ICARUS_PROVIDER: "meta" })).toThrow(
      /MODEL_API_KEY/,
    );
  });
});

const reply = (inTok: number, outTok: number): RespondResult => ({
  id: "r",
  text: "ok",
  parsed: undefined,
  toolCalls: [],
  usage: { inputTokens: inTok, outputTokens: outTok },
});
const stub = (answer: () => RespondResult | Error) => {
  let calls = 0;
  const api: MetaApi = {
    respond: async () => {
      calls++;
      const a = answer();
      if (a instanceof Error) throw a;
      return a as never;
    },
    segment: async () => [],
  };
  return { api, calls: () => calls };
};
const LIMITS = { dailyUsd: 1, inputUsdPerMTok: 1, outputUsdPerMTok: 4 };

describe("BudgetedMeta", () => {
  it("does not call the model at all until a limit and prices are set", async () => {
    const s = stub(() => reply(1, 1));
    for (const limits of [
      { dailyUsd: undefined, inputUsdPerMTok: 1, outputUsdPerMTok: 4 },
      { dailyUsd: 1, inputUsdPerMTok: undefined, outputUsdPerMTok: 4 },
      limitsFromEnv({}),
    ]) {
      const guarded = new BudgetedMeta(s.api, limits);
      await expect(guarded.respond({ input: "hi" })).rejects.toMatchObject({ category: "budget" });
      await expect(guarded.segment({ image: "x", phrase: "y" })).rejects.toBeInstanceOf(MetaError);
    }
    expect(s.calls()).toBe(0);
  });

  it("adds up what each call cost from its token counts and stops at the limit", async () => {
    const s = stub(() => reply(200_000, 100_000)); // 0.2 + 0.4 = $0.60 a call
    const guarded = new BudgetedMeta(s.api, LIMITS);
    await guarded.respond({ input: "a" });
    expect(await guarded.spentToday()).toBeCloseTo(0.6, 9);
    await guarded.respond({ input: "b" }); // 0.6 < 1, allowed; total now 1.2
    expect(await guarded.spentToday()).toBeCloseTo(1.2, 9);
    await expect(guarded.respond({ input: "c" })).rejects.toThrow(
      /daily model budget of \$1 is used up/,
    );
    expect(s.calls()).toBe(2);
  });

  it("starts a new day with a clean count, and a failed call costs nothing", async () => {
    let day = new Date("2026-11-01T10:00:00Z");
    let fail = false;
    const s = stub(() => (fail ? new MetaError("server", "boom") : reply(1_000_000, 0))); // $1 a call
    const guarded = new BudgetedMeta(s.api, LIMITS, memoryStore(), () => day);
    await guarded.respond({ input: "a" });
    await expect(guarded.respond({ input: "b" })).rejects.toMatchObject({ category: "budget" });
    day = new Date("2026-11-02T00:00:01Z");
    expect(await guarded.spentToday()).toBe(0);
    fail = true;
    await expect(guarded.respond({ input: "c" })).rejects.toMatchObject({ category: "server" });
    expect(await guarded.spentToday()).toBe(0);
  });

  it("reads limits from the environment and ignores junk", () => {
    expect(
      limitsFromEnv({
        ICARUS_DAILY_BUDGET_USD: "5",
        ICARUS_PRICE_IN_USD_PER_MTOK: "0.5",
        ICARUS_PRICE_OUT_USD_PER_MTOK: "2",
      }),
    ).toEqual({ dailyUsd: 5, inputUsdPerMTok: 0.5, outputUsdPerMTok: 2 });
    expect(
      limitsFromEnv({ ICARUS_DAILY_BUDGET_USD: "lots", ICARUS_PRICE_IN_USD_PER_MTOK: "-1" }),
    ).toEqual({ dailyUsd: undefined, inputUsdPerMTok: undefined, outputUsdPerMTok: undefined });
  });
});
