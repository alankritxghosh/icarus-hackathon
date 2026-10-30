import { dominantColours, type MeasuredColours, type PhotoRead } from "@icarus/core";
export class RenderError extends Error {
  constructor(
    readonly kind: "limit" | "unavailable" | "failed",
    message: string,
  ) {
    super(message);
  }
}

export interface ReadResult {
  read: PhotoRead;
  /** Colours measured from the pixels, which take priority over the model's guess. */
  measured: MeasuredColours;
  /** The photo as sent: a JPEG no wider than 1024 px. */
  image: string;
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new RenderError("failed", "That image could not be opened."));
    img.src = src;
  });
}

function draw(img: HTMLImageElement, width: number): HTMLCanvasElement {
  const scale = Math.min(1, width / img.naturalWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A JPEG data URL of an image at a size the service accepts. */
export async function downscale(src: string, width = 1024): Promise<string> {
  return draw(await load(src), width).toDataURL("image/jpeg", 0.85);
}

/** Read a photograph: a model reads what is in it, and plain code measures its colours. */
export async function readPhoto(src: string): Promise<ReadResult> {
  const img = await load(src);
  const image = draw(img, 1024).toDataURL("image/jpeg", 0.85);
  const small = draw(img, 320);
  const pixels = small.getContext("2d")?.getImageData(0, 0, small.width, small.height);
  const measured = pixels ? dominantColours(pixels.data, small.width, small.height) : {};

  let response: Response;
  try {
    response = await fetch("/api/read-photo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image }),
    });
  } catch {
    throw new RenderError(
      "unavailable",
      "The photo service is not reachable. Check that it is running and try again.",
    );
  }
  const body = (await response.json().catch(() => ({}))) as { read?: PhotoRead; error?: unknown };
  if (response.status === 429)
    throw new RenderError("limit", "Today's free allowance is used up. It resets daily.");
  if (!response.ok || !body.read)
    throw new RenderError(
      "failed",
      typeof body.error === "string" ? body.error : "The photo could not be read.",
    );
  return { read: body.read, measured, image };
}
