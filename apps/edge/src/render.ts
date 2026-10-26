import { z } from "zod";

/** The part of the Workers AI binding this Worker uses. */
export interface AiBinding {
  run(model: string, input: unknown): Promise<unknown>;
}

export interface Env {
  AI: AiBinding;
}

/** Image-to-image: repaints a reference picture. */
export const EDIT_MODEL = "@cf/black-forest-labs/flux-2-klein-4b";
/** Text-to-image fallback when no reference is given. */
export const TEXT_MODEL = "@cf/black-forest-labs/flux-1-schnell";

const MAX_REFERENCE_BYTES = 3 * 1024 * 1024;
const DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;

const Body = z.object({
  prompt: z.string().min(8).max(1500),
  /** A data URL of the snapshot to repaint. */
  reference: z.string().optional(),
  /** A data URL of a photo whose look the result should follow. Only used with `reference`. */
  styleReference: z.string().optional(),
  /** Multiples of 16, as the model requires. */
  width: z.int().min(256).max(1024).multipleOf(16).default(1024),
  height: z.int().min(256).max(1024).multipleOf(16).default(576),
  seed: z
    .int()
    .min(0)
    .max(2 ** 31 - 1)
    .optional(),
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const ImageOut = z.looseObject({ image: z.string().min(1) });

/** POST /api/render. Validates everything, then calls the model; never echoes model internals. */
export async function handleRender(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success)
    return json(
      {
        error: "invalid request",
        issues: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      400,
    );
  const { prompt, reference, styleReference, width, height, seed } = parsed.data;

  try {
    let result: unknown;
    let model = TEXT_MODEL;
    if (reference) {
      const match = DATA_URL.exec(reference);
      if (!match?.[1] || !match[2])
        return json({ error: "reference must be a png, jpeg or webp data URL" }, 400);
      const bytes = Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0));
      if (bytes.length > MAX_REFERENCE_BYTES)
        return json({ error: "reference image is too large" }, 413);
      const form = new FormData();
      form.append("prompt", prompt);
      form.append("input_image_0", new Blob([bytes], { type: match[1] }), "reference");
      if (styleReference) {
        const style = DATA_URL.exec(styleReference);
        if (!style?.[1] || !style[2])
          return json({ error: "styleReference must be a png, jpeg or webp data URL" }, 400);
        const styleBytes = Uint8Array.from(atob(style[2]), (c) => c.charCodeAt(0));
        if (styleBytes.length > MAX_REFERENCE_BYTES)
          return json({ error: "style reference image is too large" }, 413);
        form.append("input_image_1", new Blob([styleBytes], { type: style[1] }), "style");
      }
      form.append("width", String(width));
      form.append("height", String(height));
      if (seed !== undefined) form.append("seed", String(seed));
      const wrapped = new Response(form);
      model = EDIT_MODEL;
      result = await env.AI.run(model, {
        multipart: { body: wrapped.body, contentType: wrapped.headers.get("content-type") },
      });
    } else {
      result = await env.AI.run(model, {
        prompt,
        steps: 4,
        ...(seed !== undefined ? { seed } : {}),
      });
    }
    const out = ImageOut.safeParse(result);
    if (!out.success) return json({ error: "the model returned no image" }, 502);
    return json({ image: out.data.image, mediaType: "image/jpeg", model });
  } catch (error) {
    // Free-tier exhaustion and model errors surface here; report the kind, not the internals.
    const message = error instanceof Error ? error.message : "";
    const limited = /limit|quota|neurons|capacity/i.test(message);
    return json(
      { error: limited ? "the free daily image allowance is used up" : "image generation failed" },
      limited ? 429 : 502,
    );
  }
}
