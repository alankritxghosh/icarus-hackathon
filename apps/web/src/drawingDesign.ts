import type { Scene, Viewpoint } from "@icarus/core";
import {
  extractEvidence,
  extractEvidenceAuto,
  modelFromEvidence,
  sceneFromModel,
  unitMmFromScale,
} from "@icarus/spatial/model";

export class DrawingError extends Error {}

interface Views {
  svg: string;
  bboxHtml: string;
  page: number;
}

const MESSAGES: Record<number, string> = {
  400: "That does not look like a PDF.",
  413: "That PDF is too large (8 MB at most).",
  422: "That PDF could not be read.",
  429: "Too many drawings just now; give it a minute.",
  503: "Reading drawings is not set up on this server yet.",
};

/** Sends a PDF to the server, which reads its shapes and words with poppler. */
export async function readDrawingViews(
  file: Blob,
  page = 1,
  send: typeof fetch = fetch,
): Promise<Views> {
  let response: Response;
  try {
    response = await send(`/api/drawing/views?page=${page}`, {
      method: "POST",
      headers: { "content-type": "application/pdf" },
      body: file,
    });
  } catch {
    throw new DrawingError("I could not reach the drawing reader.");
  }
  if (!response.ok)
    throw new DrawingError(MESSAGES[response.status] ?? "I could not read that drawing.");
  const views = (await response.json()) as Partial<Views>;
  if (typeof views.svg !== "string" || typeof views.bboxHtml !== "string")
    throw new DrawingError("The drawing reader sent something unexpected.");
  return views as Views;
}

/** A scale the person gave in words, such as "1:100" or "scale 1/50" or "1 to 100". */
export function scaleInText(text: string): number | undefined {
  const m = /\b1\s*(?::|\/|to)\s*(\d{2,4})\b/i.exec(text);
  const n = m ? Number(m[1]) : undefined;
  return n && n >= 5 && n <= 5000 ? n : undefined;
}

export interface DrawnDesign {
  scene: Scene;
  labels: { name: string; x: number; y: number }[];
  viewpoints: Viewpoint[];
  name: string;
  /** What Icarus tells the person about what it read, one line each. */
  lines: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Reads a drawing into a building: its walls, doors and windows, and the rooms the walls enclose, drawn in 3D. The scale
 * is read from the sheet's dimension strings unless the person says it. Nothing is added that the drawing does not show
 * except the outer wall where the sheet draws only an outline, and that is said.
 */
export async function designFromDrawing(
  file: Blob,
  name: string,
  said = "",
  send: typeof fetch = fetch,
): Promise<DrawnDesign> {
  const { svg, bboxHtml } = await readDrawingViews(file, 1, send);
  const ratio = scaleInText(said);
  let evidence: ReturnType<typeof extractEvidence>["evidence"];
  let scaleLine: string;
  try {
    if (ratio) {
      evidence = extractEvidence(svg, bboxHtml, name, { unitMm: unitMmFromScale(ratio) }).evidence;
      scaleLine = `Scale 1:${ratio}, as you said.`;
    } else {
      const out = extractEvidenceAuto(svg, bboxHtml, name);
      evidence = out.evidence;
      scaleLine =
        out.scale.basis === "dimension strings"
          ? `I read the scale from the drawing's own dimensions (about 1:${Math.round(out.scale.unitMm / unitMmFromScale(1))}).`
          : `I used the scale printed on the sheet (1:${Math.round(out.scale.unitMm / unitMmFromScale(1))}).`;
    }
  } catch (error) {
    throw new DrawingError(
      error instanceof Error && /scale could not be read/.test(error.message)
        ? "I could not read the scale from that drawing. Tell me the scale it was printed at, for example “1:100”, and attach it again."
        : error instanceof Error
          ? error.message
          : "I could not read that drawing.",
    );
  }
  const { model, report } = modelFromEvidence(evidence, { name });
  const drawn = sceneFromModel(model);
  const lines = [
    `${scaleLine} I found ${plural(report.walls, "wall")} and ${plural(report.openings, "door or window", "doors and windows")}.`,
  ];
  if (report.closedMm > 0)
    lines.push(
      `The sheet draws no wall along ${Math.round(report.closedMm / 1000)} m of the outline, so I closed it there; those walls are my addition.`,
    );
  if (report.spaces > 0)
    lines.push(
      `${report.spaces} of ${evidence.labels.length} labelled rooms are enclosed by the walls and have floors.`,
    );
  if (report.unplaced.length)
    lines.push(
      `I did not guess the rest (${report.unplaced.slice(0, 5).join(", ")}${report.unplaced.length > 5 ? ", …" : ""}): the drawn walls do not close them.`,
    );
  lines.push("I added no furniture, because a drawing's furniture is only lines.");
  return { scene: drawn.scene, labels: drawn.labels, viewpoints: drawn.viewpoints, name, lines };
}
