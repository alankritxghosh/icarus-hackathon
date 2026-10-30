/** The part of the Workers AI binding this Worker uses. */
export interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

/** Cloudflare's rate-limiting binding: counts calls per key over a short period, per location. */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface Env {
  AI: AiBinding;
  /** The Modal drawing worker (workers/drawing). Both are secrets; without them the drawing route says so. */
  DRAWING_WORKER_URL?: string;
  DRAWING_WORKER_TOKEN?: string;
  /** Per caller and across all callers; absent in tests and local runs, where nothing is limited. */
  DRAWING_LIMIT_CALLER?: RateLimiter;
  DRAWING_LIMIT_ALL?: RateLimiter;
}
