import type { EvidenceItem } from "@icarus/core";
import {
  alignEvidenceToModel,
  auditAgainstDrawing,
  extractEvidence,
  extractEvidenceAuto,
  fromFloorPlan,
  modelFromEvidence,
  toDxf,
  unitMmFromScale,
} from "@icarus/spatial/model";
import type { Built } from "./design";

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
    throw new DrawingError("The drawing reader could not be reached.");
  }
  if (!response.ok)
    throw new DrawingError(MESSAGES[response.status] ?? "The drawing could not be read.");
  const views = (await response.json()) as Partial<Views>;
  if (typeof views.svg !== "string" || typeof views.bboxHtml !== "string")
    throw new DrawingError("The drawing reader sent something unexpected.");
  return views as Views;
}

const sentence = (text: string | undefined) =>
  text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}. ` : "";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Compares this design with a drawing: reads the drawing's walls and room labels, slides them onto the design, and
 * lists what disagrees. The scale is the person's to give; it is not guessed from the picture.
 */
export async function checkAgainstDrawing(
  file: Blob,
  name: string,
  ratio: number | undefined,
  built: Built,
  deps: { send?: typeof fetch } = {},
): Promise<EvidenceItem[]> {
  if (ratio !== undefined && (!Number.isFinite(ratio) || ratio < 1 || ratio > 5000))
    throw new DrawingError(
      "Enter the scale the sheet was printed at, such as 100 for 1:100, or leave it empty.",
    );
  const { svg, bboxHtml } = await readDrawingViews(file, 1, deps.send);
  let extracted: ReturnType<typeof extractEvidence>;
  try {
    extracted =
      ratio === undefined
        ? extractEvidenceAuto(svg, bboxHtml, name)
        : extractEvidence(svg, bboxHtml, name, { unitMm: unitMmFromScale(ratio) });
  } catch (error) {
    throw new DrawingError(
      error instanceof Error ? error.message : "The drawing could not be read.",
    );
  }
  const model = fromFloorPlan(built.plan, { program: built.program });
  const { evidence, shiftMm } = alignEvidenceToModel(extracted.evidence, model);
  const audit = auditAgainstDrawing(model, evidence);
  const { report } = extracted;
  const dropped = report.dropped.notRectangle + report.dropped.hollow;

  const items: EvidenceItem[] = [
    {
      id: "drawing-read",
      label: "What was read from the drawing",
      status: "info",
      detail:
        `${plural(evidence.wallRects.length, "wall shape")} and ${plural(evidence.labels.length, "room label")} ${ratio === undefined ? "" : ` at 1:${ratio}`}. ${dropped ? `${plural(dropped, "shape")} (curves, slanted or hollow) were not read. ` : ""}${sentence(report.assumptions[0])}The drawing was moved ${Math.round(shiftMm[0])}, ${Math.round(shiftMm[1])} mm to sit on the design.`.trim(),
    },
  ];
  const errors = audit.findings.filter((f) => f.level === "error");
  const warns = audit.findings.filter((f) => f.level === "warn");
  items.push(
    errors.length
      ? {
          id: "drawing-audit",
          label: "Against the drawing",
          status: "fail",
          detail: `${plural(errors.length, "difference")}. First: ${errors[0]?.message}.`,
        }
      : {
          id: "drawing-audit",
          label: "Against the drawing",
          status: warns.length ? "warn" : "ok",
          detail: warns.length
            ? `No walls added or missing. ${warns[0]?.message}.`
            : `${plural(audit.checked.modelWalls, "wall")} all on the drawing, every drawn wall in the design.`,
        },
  );
  for (const f of [...errors.slice(1), ...warns].slice(0, 6))
    items.push({
      id: `drawing-${f.code}-${f.ids.join("-")}`,
      label: f.level === "error" ? "Different from the drawing" : "Worth a look",
      status: f.level === "error" ? "fail" : "warn",
      detail: `${f.message}.`,
    });
  items.push({
    id: "drawing-not-checked",
    label: "Not checked",
    status: "info",
    detail: `${audit.notAudited.join("; ")}.`,
  });
  return items;
}

/**
 * Reads a drawing into a model of its own (walls, doors and windows, and the rooms its walls enclose) and a DXF of it,
 * for a person who wants the plan as a file they can edit. Rooms the walls do not close are listed, never guessed.
 */
export async function drawingAsModel(
  file: Blob,
  name: string,
  ratio: number | undefined,
  deps: { send?: typeof fetch } = {},
): Promise<{ dxf: string; summary: EvidenceItem }> {
  if (ratio !== undefined && (!Number.isFinite(ratio) || ratio < 1 || ratio > 5000))
    throw new DrawingError(
      "Enter the scale the sheet was printed at, such as 100 for 1:100, or leave it empty.",
    );
  const { svg, bboxHtml } = await readDrawingViews(file, 1, deps.send);
  try {
    const { evidence } =
      ratio === undefined
        ? extractEvidenceAuto(svg, bboxHtml, name)
        : extractEvidence(svg, bboxHtml, name, { unitMm: unitMmFromScale(ratio) });
    const { model, report } = modelFromEvidence(evidence, { name: name.replace(/\.pdf$/i, "") });
    const labelled = report.spaces + report.unplaced.length;
    return {
      dxf: toDxf(model).dxf,
      summary: {
        id: "drawing-model",
        label: "Plan read from the drawing",
        status: report.unplaced.length ? "warn" : "ok",
        detail: `${plural(report.walls, "wall")}, ${plural(report.openings, "door or window", "doors and windows")} and ${report.spaces} of ${plural(labelled, "labelled room")} that the walls enclose.${report.unplaced.length ? ` Left out because the drawn walls do not close them: ${report.unplaced.slice(0, 6).join(", ")}${report.unplaced.length > 6 ? ", …" : ""}.` : ""}`,
      },
    };
  } catch (error) {
    throw new DrawingError(
      error instanceof Error ? error.message : "The drawing could not be read.",
    );
  }
}
