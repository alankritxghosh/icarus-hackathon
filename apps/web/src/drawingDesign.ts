import type { Scene, Viewpoint } from "@icarus/core";
import type { DrawingEvidence, OpeningRecord, RoomTrace } from "@icarus/spatial/model";
import {
  extractEvidence,
  extractEvidenceAuto,
  modelFromEvidence,
  SpatialModel,
  sceneFromModel,
  unitMmFromScale,
} from "@icarus/spatial/model";

export class DrawingError extends Error {}

interface Views {
  svg: string;
  bboxHtml: string;
  pngBase64?: string;
  page: number;
}

export interface PlanReference {
  levelId: string;
  name: string;
  image: string;
  pageWidth: number;
  pageHeight: number;
  unitMm: number;
  offsetMm: [number, number];
  labels: { id: string; name: string; x: number; y: number }[];
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
  model: SpatialModel;
  baseModel?: SpatialModel;
  plans?: PlanReference[];
  traces?: RoomTrace[];
  reviewedOpenings?: OpeningRecord[];
  /** Working drawing shapes, retained so a later edit can rebuild rooms and openings. */
  evidence?: DrawingEvidence;
  scene: Scene;
  labels: { name: string; x: number; y: number; w: number; h: number }[];
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
    const message = error instanceof Error ? error.message : "";
    throw new DrawingError(
      /scale could not be read/.test(message)
        ? "I could not read the scale from that drawing. Tell me the scale it was printed at, for example “1:100”, and attach it again."
        : /no wall fill found/.test(message)
          ? "I could not identify solid walls in that PDF. It may be a scan or use line-only walls, which I cannot read yet."
          : error instanceof Error
            ? message
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
  lines.push(
    drawn.furnished.length
      ? `I furnished ${drawn.furnished.join(", ")} by what the sheet calls them. Every other room is as drawn, because a drawing's furniture is only lines.`
      : "I added no furniture, because a drawing's furniture is only lines.",
  );
  return {
    model,
    evidence,
    scene: drawn.scene,
    labels: drawn.labels,
    viewpoints: drawn.viewpoints,
    name,
    lines,
  };
}

/** Two PDF sheets from one building, read in one pass so a scale on either sheet can serve both. */
export async function designFromDrawings(
  files: File[],
  said = "",
  send: typeof fetch = fetch,
): Promise<DrawnDesign> {
  if (files.length !== 2) throw new DrawingError("Attach two floor plans together.");
  const floorNumber = (name: string) => {
    const digit = /\b(\d+)(?:st|nd|rd|th)?\s*floor\b/i.exec(name)?.[1];
    if (digit) return Number(digit);
    const word = /\b(first|second|third|fourth|fifth|sixth)\s*floor\b/i
      .exec(name)?.[1]
      ?.toLowerCase();
    return word ? ["first", "second", "third", "fourth", "fifth", "sixth"].indexOf(word) + 1 : 0;
  };
  const ordered = [...files].sort((a, b) => floorNumber(a.name) - floorNumber(b.name));
  const views = await Promise.all(ordered.map((file) => readDrawingViews(file, 1, send)));
  const ratio = scaleInText(said);
  let unitMm = ratio ? unitMmFromScale(ratio) : undefined;
  if (!unitMm) {
    const estimates = views.flatMap((view, i) => {
      try {
        return [
          extractEvidenceAuto(view.svg, view.bboxHtml, ordered[i]?.name ?? "floor").scale.unitMm,
        ];
      } catch {
        return [];
      }
    });
    unitMm = estimates[0];
    if (!unitMm)
      throw new DrawingError(
        "I could not read the scale from either plan. Attach them again with the printed scale, for example “1:80”.",
      );
    const commonScale = unitMm;
    if (estimates.some((estimate) => Math.abs(estimate - commonScale) / commonScale > 0.05))
      throw new DrawingError(
        "The plans appear to use different scales. Attach them with the correct scale.",
      );
  }
  if (!unitMm) throw new DrawingError("I could not read the scale from either plan.");
  const built = views.map((view, i) => {
    const file = ordered[i] as File;
    const extracted = extractEvidence(view.svg, view.bboxHtml, file.name, { unitMm });
    return {
      ...modelFromEvidence(extracted.evidence, {
        name: file.name.replace(/\.pdf$/i, ""),
        levelHeightMm: 3200,
      }),
      extracted,
    };
  });
  const levels = built.map(({ model }, i) => {
    const file = ordered[i] as File;
    const rank = floorNumber(file.name);
    const id = `L${rank || i + 1}`;
    return { id, name: file.name.replace(/\.pdf$/i, ""), elevationMm: i * 3200, model };
  });
  const model = SpatialModel.parse({
    ...built[0]?.model,
    name: ordered.map((file) => file.name.replace(/\.pdf$/i, "")).join(" + "),
    levels: levels.map(({ id, name, elevationMm, model }) => ({
      ...model.levels[0],
      id,
      name,
      elevationMm,
    })),
    spaces: levels.flatMap(({ id, model }) =>
      model.spaces.map((space) => ({ ...space, id: `${id}.${space.id}`, levelId: id })),
    ),
    walls: levels.flatMap(({ id, model }) =>
      model.walls.map((wall) => ({
        ...wall,
        id: `${id}.${wall.id}`,
        levelId: id,
        left: wall.left && wall.left !== "exterior" ? `${id}.${wall.left}` : wall.left,
        right: wall.right && wall.right !== "exterior" ? `${id}.${wall.right}` : wall.right,
      })),
    ),
    openings: levels.flatMap(({ id, model }) =>
      model.openings.map((opening) => ({
        ...opening,
        id: `${id}.${opening.id}`,
        hostWallId: `${id}.${opening.hostWallId}`,
      })),
    ),
    obstacles: [],
    connectors: [],
    items: [],
  });
  const drawn = sceneFromModel(model);
  const plans: PlanReference[] = views.flatMap((view, i) => {
    if (!view.pngBase64) return [];
    const page = /<page\s+width="([\d.]+)"\s+height="([\d.]+)"/.exec(view.bboxHtml);
    const level = levels[i];
    const item = built[i];
    if (!page || !level || !item) return [];
    const pageWidth = Number(page[1]);
    const pageHeight = Number(page[2]);
    const offsetMm = item.extracted.report.offsetMm;
    return [
      {
        levelId: level.id,
        name: level.name,
        image: `data:image/png;base64,${view.pngBase64}`,
        pageWidth,
        pageHeight,
        unitMm,
        offsetMm,
        labels: item.extracted.evidence.labels.map((label, index) => ({
          id: `${level.id}.${index}`,
          name: label.text,
          x: (label.at[0] - offsetMm[0]) / unitMm / pageWidth,
          y: (label.at[1] - offsetMm[1]) / unitMm / pageHeight,
        })),
      },
    ];
  });
  return {
    model,
    baseModel: model,
    plans,
    traces: [],
    scene: drawn.scene,
    labels: drawn.labels,
    viewpoints: drawn.viewpoints,
    name: model.name,
    lines: [
      `Both floors are in one 3D project. I used ${ratio ? `the 1:${ratio} scale you gave` : "a scale read from one plan"} for both and assumed 3.2 m between floors.`,
      ...built.map(
        ({ report }, i) =>
          `${ordered[i]?.name}: I could build ${report.spaces} spaces; ${report.unplaced.length} still need tracing.`,
      ),
      "I added translucent walls where the plans leave gaps. The floor alignment needs checking. You can export this draft; wall edits are not ready yet.",
    ],
  };
}
