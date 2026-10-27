// Plain-language findings about a model, in the same shape as the other measured evidence, so a
// screen can list them next to the rest without knowing what a spatial model is.
import type { EvidenceItem } from "@icarus/core";
import { circulationGraph } from "./circulation";
import type { Kernel } from "./kernel";
import type { SpatialModel } from "./schema";
import { uncertaintySummary } from "./uncertainty";
import { validate } from "./validate";

export function modelEvidence(model: SpatialModel, kernel: Kernel): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const { findings } = validate(model, kernel);
  const errors = findings.filter((f) => f.level === "error");
  const warns = findings.filter((f) => f.level === "warn");
  const reach = circulationGraph(model, kernel);
  const counts = `${model.spaces.length} spaces, ${model.walls.filter((w) => w.kind !== "virtual").length} walls, ${model.openings.length} doors and windows`;
  if (errors.length || reach.unreachable.length) {
    const first =
      errors[0]?.message ??
      `${reach.unreachable.length} space(s) have no route from the front door`;
    items.push({
      id: "drawing-check",
      label: "Drawing check",
      status: "fail",
      detail: `${errors.length + reach.unreachable.length} problem(s) in the drawing. First: ${first}.`,
    });
  } else if (warns.length) {
    items.push({
      id: "drawing-check",
      label: "Drawing check",
      status: "warn",
      detail: `${counts}. ${warns[0]?.message}.`,
    });
  } else {
    items.push({
      id: "drawing-check",
      label: "Drawing check",
      status: "ok",
      detail: `${counts}: no overlaps, every door and window sits on its wall, every room has a route from the front door.`,
    });
  }

  const u = uncertaintySummary(model);
  const guessed = u.guessedIds.length;
  if (guessed === 0 && u.unquantifiedIds.length === 0) {
    items.push({
      id: "dimension-source",
      label: "Where the sizes come from",
      status: "info",
      detail:
        "Designed by Icarus: the sizes are exact in the drawing, but nothing has been surveyed on site. Wall structure is not engineered.",
    });
  } else {
    items.push({
      id: "dimension-source",
      label: "Where the sizes come from",
      status: "warn",
      detail: `${guessed} measurement(s) are estimates${u.worstToleranceMm ? ` (worst about ±${u.worstToleranceMm} mm)` : ""}; ${u.unknownStructuralWalls} wall(s) have unknown structure. Do not treat them as exact.`,
    });
  }
  return items;
}
