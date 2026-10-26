import { buildRespondBody, readResponse, validateStructured } from "./responses";
import { parseSegmentation } from "./sam";
import { Transport, type TransportOptions } from "./transport";
import {
  type MetaApi,
  type RespondRequest,
  type RespondResult,
  SAM_MODEL,
  type SamMatch,
} from "./types";

/** The real Meta Model API client (OpenAI-compatible Responses API at api.meta.ai). */
export class MetaClient implements MetaApi {
  private readonly transport: Transport;

  constructor(options: TransportOptions) {
    this.transport = new Transport(options);
  }

  async respond<T = never>(request: RespondRequest<T>): Promise<RespondResult<T>> {
    const raw = await this.transport.postJson("/responses", buildRespondBody(request));
    const result = readResponse(raw);
    const parsed = request.schema ? validateStructured(result.text, request.schema) : undefined;
    return { ...result, parsed };
  }

  async segment(request: { image: string; phrase: string }): Promise<SamMatch[]> {
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

/** Build a client from the environment without ever echoing the key. */
export function metaClientFromEnv(
  env: Record<string, string | undefined>,
  options: Partial<TransportOptions> = {},
): MetaClient {
  return new MetaClient({
    apiKey: env.MODEL_API_KEY ?? "",
    baseUrl: env.META_BASE_URL || undefined,
    ...options,
  });
}
