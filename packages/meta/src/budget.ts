// A spending limit for a paid model route. Credits are money: every call is counted and the route
// stops, loudly, when the day's limit is reached or when no limit has been set.
import { MetaError } from "./errors";
import type { MetaApi, RespondRequest, RespondResult } from "./types";

/** Somewhere to keep the day's total. A Worker can supply KV; tests and local runs use memory. */
export interface BudgetStore {
  get(key: string): Promise<number>;
  set(key: string, value: number): Promise<void>;
}

export const memoryStore = (): BudgetStore => {
  const m = new Map<string, number>();
  return { get: async (k) => m.get(k) ?? 0, set: async (k, v) => void m.set(k, v) };
};

export interface BudgetLimits {
  /** Dollars per UTC day. Required: a paid route with no limit does not run. */
  dailyUsd: number | undefined;
  /** Dollars per million tokens, from the provider's price list. Required with a limit. */
  inputUsdPerMTok: number | undefined;
  outputUsdPerMTok: number | undefined;
}

const num = (v: string | undefined) => {
  const n = Number(v);
  return v?.trim() && Number.isFinite(n) && n >= 0 ? n : undefined;
};

export const limitsFromEnv = (env: Record<string, string | undefined>): BudgetLimits => ({
  dailyUsd: num(env.ICARUS_DAILY_BUDGET_USD),
  inputUsdPerMTok: num(env.ICARUS_PRICE_IN_USD_PER_MTOK),
  outputUsdPerMTok: num(env.ICARUS_PRICE_OUT_USD_PER_MTOK),
});

const dayKey = (now: Date) => `spend:${now.toISOString().slice(0, 10)}`;

/**
 * Wraps a paid model route. Before each call it refuses if no limit or price is configured or the
 * day's total has reached the limit; after each call it adds what the call cost, from the token
 * counts the provider reported. One call can overshoot the limit by its own cost, so set the limit
 * below what you can afford to lose.
 */
export class BudgetedMeta implements MetaApi {
  get stateless() {
    return this.inner.stateless;
  }

  constructor(
    private readonly inner: MetaApi,
    private readonly limits: BudgetLimits,
    private readonly store: BudgetStore = memoryStore(),
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private configured(): { dailyUsd: number; inUsd: number; outUsd: number } {
    const { dailyUsd, inputUsdPerMTok, outputUsdPerMTok } = this.limits;
    if (dailyUsd === undefined || inputUsdPerMTok === undefined || outputUsdPerMTok === undefined)
      throw new MetaError(
        "budget",
        "The paid model route needs ICARUS_DAILY_BUDGET_USD, ICARUS_PRICE_IN_USD_PER_MTOK and ICARUS_PRICE_OUT_USD_PER_MTOK before it will run.",
      );
    return { dailyUsd, inUsd: inputUsdPerMTok, outUsd: outputUsdPerMTok };
  }

  /** Dollars spent today, for display and tests. */
  spentToday(): Promise<number> {
    return this.store.get(dayKey(this.clock()));
  }

  async respond<T = never>(request: RespondRequest<T>): Promise<RespondResult<T>> {
    const cfg = this.configured();
    const key = dayKey(this.clock());
    const spent = await this.store.get(key);
    if (spent >= cfg.dailyUsd)
      throw new MetaError(
        "budget",
        `The daily model budget of $${cfg.dailyUsd} is used up ($${spent.toFixed(4)} spent today).`,
      );
    const result = await this.inner.respond(request);
    const cost =
      (result.usage.inputTokens * cfg.inUsd + result.usage.outputTokens * cfg.outUsd) / 1_000_000;
    // Re-read before writing so concurrent calls on one store do not overwrite each other.
    await this.store.set(key, (await this.store.get(key)) + cost);
    return result;
  }

  async segment(request: { image: string; phrase: string }) {
    this.configured();
    return this.inner.segment(request);
  }
}
