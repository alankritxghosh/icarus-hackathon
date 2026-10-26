import { PHOTO_READ_INSTRUCTIONS, type PhotoRead, PhotoReadSchema } from "@icarus/core";
import { z } from "zod";
import type { Env } from "./render";

/** Meta's multimodal Llama 4 on Workers AI: free within the daily allowance. */
export const VISION_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const DATA_URL = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const Body = z.object({ image: z.string() });

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** The model may return the object, or the same object as text; accept both and validate either. */
function reading(result: unknown): PhotoRead | undefined {
  const raw = (result as { response?: unknown } | null)?.response;
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  const checked = PhotoReadSchema.safeParse(value);
  return checked.success ? checked.data : undefined;
}

/** POST /api/read-photo: one photograph in, a validated PhotoRead out. */
export async function handleReadPhoto(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }
  const body = Body.safeParse(raw);
  if (!body.success || !DATA_URL.test(body.data.image))
    return json({ error: "image must be a png, jpeg or webp data URL" }, 400);
  if (body.data.image.length * 0.75 > MAX_IMAGE_BYTES)
    return json({ error: "image is too large" }, 413);

  const { $schema: _ignored, ...schema } = z.toJSONSchema(PhotoReadSchema) as Record<
    string,
    unknown
  >;
  try {
    const result = await env.AI.run(VISION_MODEL, {
      messages: [
        { role: "system", content: PHOTO_READ_INSTRUCTIONS },
        {
          role: "user",
          content: [
            { type: "text", text: "Describe this office photograph using the schema." },
            { type: "image_url", image_url: { url: body.data.image } },
          ],
        },
      ],
      response_format: { type: "json_schema", json_schema: schema },
      max_tokens: 900,
      temperature: 0.1,
    });
    const read = reading(result);
    if (!read)
      return json({ error: "the reading of the photo did not match what Icarus needs" }, 502);
    return json({ read, model: VISION_MODEL });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const limited = /limit|quota|neurons|capacity/i.test(message);
    return json(
      { error: limited ? "the free daily allowance is used up" : "the photo could not be read" },
      limited ? 429 : 502,
    );
  }
}
