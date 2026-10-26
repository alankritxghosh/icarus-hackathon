import { MetaError } from "./errors";
import { buildRespondBody, readResponse, validateStructured } from "./responses";
import { parseSegmentation } from "./sam";
import { Transport, type TransportOptions } from "./transport";
import {
  DEFAULT_MODEL,
  type MetaApi,
  type RespondRequest,
  type RespondResult,
  SAM_MODEL,
  type SamMatch,
} from "./types";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
/** A free model verified live for JSON output and tool calls, for development before credits exist. */
export const OPENROUTER_DEV_MODEL = "recursive/flint-v1.0:free";

export interface ClientOptions extends TransportOptions {
  /** Which service this is, for logs and the interface: never changes behaviour except below. */
  provider?: "meta" | "openrouter";
  /** Model used when a request does not name one. */
  model?: string;
}

/**
 * An OpenAI-compatible Responses API client. It talks to the Meta Model API directly or through
 * OpenRouter, which serves the same Meta models (and others) behind one key. OpenRouter keeps no
 * conversation state and has no SAM endpoint; the client reports both honestly.
 */
export class MetaClient implements MetaApi {
  readonly provider: "meta" | "openrouter";
  readonly model: string;
  readonly stateless: boolean;
  private readonly transport: Transport;

  constructor(options: ClientOptions) {
    this.provider = options.provider ?? "meta";
    this.stateless = this.provider === "openrouter";
    this.model = options.model ?? DEFAULT_MODEL;
    this.transport = new Transport(options);
  }

  async respond<T = never>(request: RespondRequest<T>): Promise<RespondResult<T>> {
    if (this.stateless && request.previousResponseId)
      throw new MetaError(
        "invalid_request",
        "OpenRouter keeps no conversation state: send the full history instead of previousResponseId",
      );
    const body = buildRespondBody({ ...request, model: request.model ?? this.model });
    const result = readResponse(await this.transport.postJson("/responses", body));
    const parsed = request.schema ? validateStructured(result.text, request.schema) : undefined;
    return { ...result, parsed };
  }

  async segment(request: { image: string; phrase: string }): Promise<SamMatch[]> {
    if (this.provider === "openrouter")
      throw new MetaError(
        "invalid_request",
        "SAM 3.1 segmentation is not available through OpenRouter",
      );
    const raw = await this.transport.postJson("/responses", {
      model: SAM_MODEL,
      input: [
        {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: request.phrase },
            { type: "input_image", image_url: request.image },
          ],
        },
      ],
      metadata: { include_confidence: "true", mask_encoding: "one_bit" },
    });
    return parseSegmentation(readResponse(raw).text);
  }
}

type Env = Record<string, string | undefined>;

/**
 * Build a client from the environment without ever echoing a key. OPENROUTER_API_KEY selects
 * OpenRouter (model from ICARUS_MODEL, default a free development model); otherwise
 * MODEL_API_KEY selects the Meta Model API directly.
 */
export function metaClientFromEnv(env: Env, options: Partial<ClientOptions> = {}): MetaClient {
  if (env.OPENROUTER_API_KEY?.trim())
    return new MetaClient({
      apiKey: env.OPENROUTER_API_KEY,
      keyName: "OPENROUTER_API_KEY",
      baseUrl: env.OPENROUTER_BASE_URL || OPENROUTER_BASE_URL,
      provider: "openrouter",
      model: env.ICARUS_MODEL || OPENROUTER_DEV_MODEL,
      ...options,
    });
  return new MetaClient({
    apiKey: env.MODEL_API_KEY ?? "",
    baseUrl: env.META_BASE_URL || undefined,
    provider: "meta",
    model: env.ICARUS_MODEL || DEFAULT_MODEL,
    ...options,
  });
}
