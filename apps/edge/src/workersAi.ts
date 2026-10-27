import {
  jsonSchema,
  type MetaApi,
  MetaError,
  type RespondRequest,
  type RespondResult,
  validateStructured,
} from "@icarus/meta";
import type { AiBinding } from "./render";

/** Meta's Llama 3.3 70B on Workers AI: a second free route, billed against the daily free allowance. */
export const WORKERS_AI_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/**
 * The model API implemented on the Workers AI binding, so the design endpoints can use it exactly
 * like the OpenRouter client. Output is parsed tolerantly and validated against the same schema.
 */
export class WorkersAiMeta implements MetaApi {
  readonly stateless = true;

  constructor(
    private readonly ai: AiBinding,
    readonly model: string = WORKERS_AI_MODEL,
  ) {}

  async respond<T = never>(request: RespondRequest<T>): Promise<RespondResult<T>> {
    if (request.previousResponseId)
      throw new MetaError("invalid_request", "Workers AI keeps no conversation state");
    const input = typeof request.input === "string" ? request.input : JSON.stringify(request.input);
    const messages = [
      ...(request.instructions ? [{ role: "system", content: request.instructions }] : []),
      { role: "user", content: input },
    ];
    const call = (constrained: boolean) =>
      this.ai.run(this.model, {
        messages,
        max_tokens: request.maxOutputTokens ?? 1500,
        temperature: 0.2,
        ...(constrained && request.schema
          ? {
              response_format: {
                type: "json_schema",
                json_schema: jsonSchema(request.schema.type),
              },
            }
          : {}),
      });
    let result: unknown;
    try {
      try {
        result = await call(true);
      } catch (error) {
        // Constrained decoding rejects some schema features. The exact shape is in the instructions
        // and the answer is validated here anyway, so ask again without the constraint.
        if (error instanceof Error && /not supported by xgrammar/i.test(error.message))
          result = await call(false);
        else throw error;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      // For the developer's log only; the browser gets a plain sentence.
      console.error(`[workers-ai] ${message.slice(0, 300)}`);
      if (/limit|quota|neurons|capacity/i.test(message))
        throw new MetaError("rate_limited", "the Workers AI free allowance is used up", {
          retryable: false,
        });
      throw new MetaError("server", "Workers AI failed", { retryable: false });
    }
    const raw = (result as { response?: unknown } | null)?.response;
    const text =
      typeof raw === "string" ? raw : raw === undefined || raw === null ? "" : JSON.stringify(raw);
    if (!text) throw new MetaError("invalid_response", "Workers AI returned no text");
    const parsed = request.schema ? validateStructured(text, request.schema) : undefined;
    return {
      id: "workers-ai",
      text,
      parsed,
      toolCalls: [],
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  async segment(): Promise<never> {
    throw new MetaError(
      "invalid_request",
      "SAM 3.1 segmentation is not available through Workers AI",
    );
  }
}

/**
 * Try the primary route; if it is busy, down or out of allowance, try the secondary. A wrong answer
 * (invalid_response) is not retried here: that is handled by asking again on the same route.
 */
export class FallbackMeta implements MetaApi {
  readonly stateless = true;
  /** Which route answered last, for the design trace. */
  lastModel: string;

  constructor(
    private readonly primary: { api: MetaApi; model: string },
    private readonly secondary: { api: MetaApi; model: string },
  ) {
    this.lastModel = primary.model;
  }

  async respond<T = never>(request: RespondRequest<T>): Promise<RespondResult<T>> {
    try {
      const result = await this.primary.api.respond(request);
      this.lastModel = this.primary.model;
      return result;
    } catch (error) {
      if (error instanceof MetaError && error.category === "invalid_response") throw error;
      // Loud, because someone who has turned the paid route on should know when it was not used.
      console.error(
        `[design] ${this.primary.model} not used (${error instanceof MetaError ? error.category : "error"}); using ${this.secondary.model}`,
      );
      const result = await this.secondary.api.respond(request);
      this.lastModel = this.secondary.model;
      return result;
    }
  }

  segment(request: { image: string; phrase: string }) {
    return this.primary.api.segment(request);
  }
}
