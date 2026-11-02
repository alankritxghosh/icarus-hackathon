import type { Scene, Viewpoint } from "@icarus/core";
import type { SpatialModel } from "@icarus/spatial/model";
import { assessCompletion } from "./completion";
import type { Built } from "./design";

/**
 * What Icarus shows in the chat once a build is done: the steps it took, each with one measured fact, and at most
 * one line about what it estimated. Every number comes from the model or the plan, never from a language model.
 */
export interface BuildCard {
  steps: { label: string; detail?: string }[];
  note?: string;
}

/** The Build Summary panel: a few plain facts about the current building. */
export type Summary = { label: string; value: string }[];

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const metres = (mm: number) => `${Number((mm / 1000).toFixed(2))} m`;

export const roomViews = (viewpoints: Viewpoint[]) =>
  viewpoints.filter((point) => /(^|\.)room\./.test(point.id));

/** The card for a building read from floor plans. */
export function drawingCard(drawing: {
  model: SpatialModel;
  plans?: unknown[];
  scene: Scene;
}): BuildCard {
  const { model, scene } = drawing;
  const levels = [...model.levels].sort((a, b) => a.elevationMm - b.elevationMm);
  const lit = new Set(
    scene.nodes.filter((node) => node.type === "light" && node.roomId).map((node) => node.roomId),
  );
  const furnished = new Set(
    scene.nodes
      .filter((node) => node.type === "furniture" && node.roomId)
      .map((node) => node.roomId),
  );
  const sheets = drawing.plans?.length ?? 0;
  const steps: BuildCard["steps"] = [
    {
      label: sheets > 1 ? "Read both floor plans" : "Read the floor plan",
      ...(sheets ? { detail: plural(sheets, "sheet") } : {}),
    },
    { label: "Traced rooms, walls and openings", detail: plural(model.spaces.length, "space") },
  ];
  const [lower, upper] = levels;
  if (lower && upper)
    steps.push({
      label: "Joined the floors at the stair",
      detail: `${metres(upper.elevationMm - lower.elevationMm)} apart`,
    });
  if (furnished.size || lit.size)
    steps.push({
      label: "Furnished and lit the rooms",
      detail: plural(Math.max(furnished.size, lit.size), "room"),
    });
  steps.push({
    label: "Placed doors and openings",
    detail: plural(model.openings.length, "opening"),
  });

  const estimatedOpenings = model.openings.filter(
    (opening) => opening.provenance.source === "estimated",
  ).length;
  const estimatedRooms = model.spaces.some((space) => space.provenance.source === "estimated");
  const guessed = [
    estimatedRooms ? "the room outlines" : undefined,
    estimatedOpenings ? plural(estimatedOpenings, "opening") : undefined,
  ].filter(Boolean);
  const height =
    lower && upper && estimatedRooms
      ? `, and assumed ${metres(upper.elevationMm - lower.elevationMm)} from floor to floor`
      : "";
  return {
    steps,
    ...(guessed.length
      ? {
          note: `I estimated ${guessed.join(" and ")} from the drawings${height}. Tell me if any of them look wrong.`,
        }
      : {}),
  };
}

/** The card for an office designed from a brief or a photo. */
export function officeCard(built: Built): BuildCard {
  const { plan, report, trace } = built;
  const desksPlaced = report.seatsPlaced + report.privateDesksPlaced;
  const desksWanted = report.seatsWanted + report.privateDesksWanted;
  const steps: BuildCard["steps"] = [
    { label: "Planned the rooms", detail: plural(plan.rooms.length, "room") },
    { label: "Fitted them in the shell", detail: `${plan.shell.w} × ${plan.shell.h} m` },
  ];
  if (trace?.proposal === "model") {
    const used = trace.decisions.filter((decision) => decision.used).length;
    steps.push({
      label: "Weighed the model's proposal",
      detail: `${used} of ${plural(trace.decisions.length, "idea")} kept`,
    });
  }
  steps.push({ label: "Furnished the rooms", detail: `${desksPlaced} of ${desksWanted} desks` });
  const status = assessCompletion(built);
  steps.push({
    label: "Checked and repaired the plan",
    detail: status.complete ? "no open issues" : plural(status.lines.length, "open issue"),
  });
  return status.lines.length ? { steps, note: status.lines.join(" ") } : { steps };
}

export function drawingSummary(model: SpatialModel, viewpoints: Viewpoint[]): Summary {
  return [
    { label: "Floors", value: String(model.levels.length) },
    { label: "Spaces", value: String(model.spaces.length) },
    { label: "Doors and openings", value: String(model.openings.length) },
    { label: "Rooms to visit", value: String(roomViews(viewpoints).length) },
  ].filter((row) => row.label !== "Rooms to visit" || row.value !== "0");
}

export function officeSummary(built: Built): Summary {
  const { plan, report } = built;
  return [
    { label: "Floor area", value: `${Math.round(plan.shell.w * plan.shell.h)} m²` },
    { label: "Rooms", value: String(plan.rooms.length) },
    { label: "Desks", value: String(report.seatsPlaced + report.privateDesksPlaced) },
    {
      label: "Meeting rooms",
      value: String(plan.rooms.filter((room) => room.kind === "meeting_room").length),
    },
  ];
}
