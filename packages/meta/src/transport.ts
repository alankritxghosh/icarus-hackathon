import { MetaError } from "./errors";

export type FetchFn = typeof globalThis.fetch;

export interface TransportOptions {
  apiKey: string;
  /** Name of the environment variable the key came from, for the error message only. */
  keyName?: string;
  baseUrl?: string;
  fetch?: FetchFn;
  maxRetries?: number;
  timeoutMs?: number;
  /** Injected so tests do not wait. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected so retry jitter is deterministic in tests. */
  random?: () => number;
}

export const DEFAULT_BASE_URL = "https://api.meta.ai/v1";
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

/**
 * Minimal HTTP layer for the OpenAI-compatible Meta Model API: bearer auth, a request timeout,
 * and retries with exponential backoff and jitter on rate limits and server errors (honouring
 * Retry-After). Everything else fails fast with a categorised MetaError.
 */
export class Transport {
  private readonly baseUrl: string;
  private readonly doFetch: FetchFn;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly options: TransportOptions) {
    if (!options.apiKey.trim())
      throw new MetaError("auth", `${options.keyName ?? "MODEL_API_KEY"} is not set`);
    this.baseUrl = (options.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, "");
    this.doFetch = options.fetch ?? globalThis.fetch;
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 120_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.random = options.random ?? Math.random;
  }

  async postJson(path: string, body: unknown): Promise<unknown> {
    return this.send(path, { "content-type": "application/json" }, JSON.stringify(body));
  }

  async postForm(path: string, form: FormData): Promise<unknown> {
    return this.send(path, {}, form);
  }

  private async send(
    path: string,
    headers: Record<string, string>,
    body: string | FormData,
  ): Promise<unknown> {
    let lastError: MetaError | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await this.once(path, headers, body);
      } catch (error) {
        if (!(error instanceof MetaError) || !error.retryable || attempt === this.maxRetries)
          throw error;
        lastError = error;
        const backoff =
          error.options.retryAfterMs ?? 500 * 2 ** attempt + Math.floor(this.random() * 250);
        await this.sleep(backoff);
      }
    }
    throw lastError ?? new MetaError("network", "request failed");
  }

  private async once(
    path: string,
    headers: Record<string, string>,
    body: string | FormData,
  ): Promise<unknown> {
    let response: Response;
    try {
      response = await this.doFetch(`${this.baseUrl}${path}`, {
        method: "POST",
        headers: { ...headers, authorization: `Bearer ${this.options.apiKey}` },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const timedOut =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      throw new MetaError(
        timedOut ? "timeout" : "network",
        timedOut ? `request timed out after ${this.timeoutMs} ms` : "network error",
        { retryable: true },
      );
    }
    const text = await response.text();
    if (response.ok) {
      try {
        return JSON.parse(text);
      } catch {
        throw new MetaError("invalid_response", "response was not JSON", {
          status: response.status,
        });
      }
    }
    const detail = errorDetail(text);
    const status = response.status;
    if (status === 401 || status === 403)
      throw new MetaError("auth", `authentication failed (${status})`, { status });
    if (RETRYABLE.has(status)) {
      const retryAfter = Number(response.headers.get("retry-after"));
      throw new MetaError(status === 429 ? "rate_limited" : "server", `${status}${detail}`, {
        status,
        retryable: true,
        retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
      });
    }
    throw new MetaError("invalid_request", `${status}${detail}`, { status });
  }
}

function errorDetail(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: string } };
    return body.error?.message ? `: ${body.error.message.slice(0, 300)}` : "";
  } catch {
    return "";
  }
}
