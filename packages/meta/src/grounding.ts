import { z } from "zod";
import type { MetaApi } from "./types";

export interface Located {
  label: string;
  /** 0..1 from the top-left of the image. */
  x: number;
  y: number;
}

export interface LocatedBox {
  label: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const Point = z.object({
  items: z.array(
    z.object({ label: z.string(), x: z.int().min(0).max(1000), y: z.int().min(0).max(1000) }),
  ),
});
const Box = z.object({
  items: z.array(
    z.object({
      label: z.string(),
      x_min: z.int().min(0).max(1000),
      y_min: z.int().min(0).max(1000),
      x_max: z.int().min(0).max(1000),
      y_max: z.int().min(0).max(1000),
    }),
  ),
});

const norm = (v: number) => v / 1000;

/**
 * Ask Muse Spark where named things are in an image. It answers on a 0 to 1000 grid and omits
 * what it cannot find, so unfound labels are returned separately instead of being invented.
 */
export async function locatePoints(api: MetaApi, request: { image: string; labels: string[] }) {
  const response = await api.respond({
    input: [
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Point to each of these in the image: ${request.labels.join(", ")}. Return a JSON object with "items", each having "label" (exactly as named), "x" and "y" as integers on a normalized 0-1000 grid with (0,0) at the top-left. Omit anything you cannot see.`,
          },
          { type: "input_image", image_url: request.image },
        ],
      },
    ],
    schema: { name: "PointsInImage", type: Point },
  });
  const wanted = new Set(request.labels);
  const found = (response.parsed?.items ?? [])
    .filter((item) => wanted.has(item.label))
    .map((item) => ({ label: item.label, x: norm(item.x), y: norm(item.y) }));
  const seen = new Set(found.map((item) => item.label));
  return { found: found as Located[], missing: request.labels.filter((label) => !seen.has(label)) };
}

export async function locateBoxes(api: MetaApi, request: { image: string; labels: string[] }) {
  const response = await api.respond({
    input: [
      {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Draw a bounding box around each of these in the image: ${request.labels.join(", ")}. Return a JSON object with "items", each having "label" (exactly as named) and integers "x_min", "y_min", "x_max", "y_max" on a normalized 0-1000 grid with (0,0) at the top-left. Omit anything you cannot see.`,
          },
          { type: "input_image", image_url: request.image },
        ],
      },
    ],
    schema: { name: "BoxesInImage", type: Box },
  });
  const wanted = new Set(request.labels);
  const found = (response.parsed?.items ?? [])
    .filter((item) => wanted.has(item.label) && item.x_max > item.x_min && item.y_max > item.y_min)
    .map((item) => ({
      label: item.label,
      x1: norm(item.x_min),
      y1: norm(item.y_min),
      x2: norm(item.x_max),
      y2: norm(item.y_max),
    }));
  const seen = new Set(found.map((item) => item.label));
  return {
    found: found as LocatedBox[],
    missing: request.labels.filter((label) => !seen.has(label)),
  };
}
