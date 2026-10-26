import { describeStyle } from "@icarus/core";
import type { Built } from "./design";

export interface MadeReal {
  /** A data URL of the repainted picture. */
  image: string;
  model: string;
}

export class RenderError extends Error {
  constructor(
    readonly kind: "limit" | "unavailable" | "failed",
    message: string,
  ) {
    super(message);
  }
}

/** What the picture should look like, built from the office itself, not typed by the user. */
export function renderPrompt(built: Built, viewName: string, hasStyleReference = false): string {
  const { headcount } = built.program.company;
  const look = describeStyle(built.program.style);
  return [
    `Hyper-realistic architectural interior photograph of the ${viewName.toLowerCase()} of a modern ${headcount}-person coworking office.`,
    "Keep the room, walls, windows, doors, desks, chairs, sofas and plants in exactly the same positions as the reference image.",
    `${look.floor[0]?.toUpperCase()}${look.floor.slice(1)}, ${look.furniture}, ${look.walls}, ${look.ceiling}.`,
    "Soft natural daylight, realistic materials, soft shadows and reflections.",
    "Shot on a full-frame camera with a 24mm lens at eye height. No text, no logos.",
    ...(hasStyleReference
      ? [
          "The second image is a style reference: match its floor, materials, colours, furniture style and lighting mood, but keep the layout of the first image.",
        ]
      : []),
  ].join(" ");
}

/** Sends a snapshot to the render service and returns the repainted picture. */
export async function makeItReal(
  image: string,
  prompt: string,
  seed: number,
  size: { width: number; height: number },
  styleReference?: string,
): Promise<MadeReal> {
  let response: Response;
  try {
    response = await fetch("/api/render", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt, reference: image, styleReference, seed, ...size }),
    });
  } catch {
    throw new RenderError(
      "unavailable",
      "The picture service is not reachable. Check that it is running and try again.",
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new RenderError("failed", "The picture service sent something unreadable.");
  }
  const data = body as { image?: unknown; mediaType?: unknown; model?: unknown; error?: unknown };
  if (response.status === 429)
    throw new RenderError("limit", "Today's free picture allowance is used up. It resets daily.");
  if (!response.ok || typeof data.image !== "string")
    throw new RenderError(
      "failed",
      typeof data.error === "string" ? data.error : "The picture could not be made.",
    );
  const mediaType = typeof data.mediaType === "string" ? data.mediaType : "image/jpeg";
  return {
    image: `data:${mediaType};base64,${data.image}`,
    model: typeof data.model === "string" ? data.model : "unknown",
  };
}
