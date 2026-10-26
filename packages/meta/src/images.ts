import { z } from "zod";
import { MetaError } from "./errors";
import { Transport, type TransportOptions } from "./transport";

/** Open-weight, image-to-image capable and cheap on OpenRouter; replaced by Muse Image when served. */
export const DEFAULT_IMAGE_MODEL = "black-forest-labs/flux.2-klein-4b";

export interface ImageRequest {
  prompt: string;
  model?: string;
  /** Data URLs or https URLs of images the result should follow, for image-to-image. */
  references?: string[];
  aspectRatio?: string;
  seed?: number;
}

export interface GeneratedImage {
  base64: string;
  mediaType: string;
}

export interface ImageResult {
  images: GeneratedImage[];
  costUsd?: number;
}

/** What the rest of Icarus depends on for pictures. The real client and the fake both implement it. */
export interface ImageApi {
  generate(request: ImageRequest): Promise<ImageResult>;
}

export function buildImageBody(
  request: ImageRequest,
  defaultModel: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model ?? defaultModel,
    prompt: request.prompt,
    n: 1,
  };
  if (request.aspectRatio) body.aspect_ratio = request.aspectRatio;
  if (request.seed !== undefined) body.seed = request.seed;
  if (request.references?.length)
    body.input_references = request.references.map((url) => ({
      type: "image_url",
      image_url: { url },
    }));
  return body;
}

const ImagesBody = z.looseObject({
  data: z
    .array(z.looseObject({ b64_json: z.string().min(1), media_type: z.string().optional() }))
    .min(1),
  usage: z.looseObject({ cost: z.number().optional() }).optional(),
});

/** Read an images response, refusing a body with no picture in it. */
export function readImages(raw: unknown): ImageResult {
  const parsed = ImagesBody.safeParse(raw);
  if (!parsed.success)
    throw new MetaError("invalid_response", "response did not contain a generated image");
  return {
    images: parsed.data.data.map((d) => ({
      base64: d.b64_json,
      mediaType: d.media_type ?? "image/png",
    })),
    costUsd: parsed.data.usage?.cost,
  };
}

export interface ImageClientOptions extends TransportOptions {
  model?: string;
}

/** OpenRouter's image API: text to image, or a reference image repainted to a prompt. */
export class OpenRouterImages implements ImageApi {
  private readonly transport: Transport;
  private readonly model: string;

  constructor(options: ImageClientOptions) {
    this.transport = new Transport(options);
    this.model = options.model ?? DEFAULT_IMAGE_MODEL;
  }

  async generate(request: ImageRequest): Promise<ImageResult> {
    return readImages(
      await this.transport.postJson("/images", buildImageBody(request, this.model)),
    );
  }
}

export function imageClientFromEnv(
  env: Record<string, string | undefined>,
  options: Partial<ImageClientOptions> = {},
): OpenRouterImages {
  return new OpenRouterImages({
    apiKey: env.OPENROUTER_API_KEY ?? "",
    keyName: "OPENROUTER_API_KEY",
    baseUrl: env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
    model: env.ICARUS_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
    // A picture can take well over a minute.
    timeoutMs: 180_000,
    ...options,
  });
}

/** Scripted pictures for tests and for the interface before a key exists. Never invents one. */
export class FakeImages implements ImageApi {
  readonly requests: ImageRequest[] = [];
  constructor(private readonly results: ImageResult[] = []) {}

  async generate(request: ImageRequest): Promise<ImageResult> {
    this.requests.push(request);
    const next = this.results.shift();
    if (!next) throw new Error("FakeImages: unscripted generate() call");
    return next;
  }
}
