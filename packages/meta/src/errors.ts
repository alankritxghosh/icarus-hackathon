export type MetaErrorCategory =
  | "auth"
  | "rate_limited"
  | "invalid_request"
  | "server"
  | "network"
  | "timeout"
  | "invalid_response"
  /** The daily spending limit for this route has been reached, or no limit is configured. */
  | "budget";

/** A failure talking to the Meta Model API. Messages never contain the API key. */
export class MetaError extends Error {
  constructor(
    readonly category: MetaErrorCategory,
    message: string,
    readonly options: { status?: number; retryable?: boolean; retryAfterMs?: number } = {},
  ) {
    super(message);
    this.name = "MetaError";
  }

  get status(): number | undefined {
    return this.options.status;
  }

  get retryable(): boolean {
    return this.options.retryable ?? false;
  }
}
