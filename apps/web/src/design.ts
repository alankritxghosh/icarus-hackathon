import {
  type Evaluation,
  type EvidenceItem,
  type FloorPlan,
  type FurnishReport,
  furnish,
  furnishingEvidence,
  layoutOffice,
  type MeasuredColours,
  measurePlan,
  type PhotoRead,
  type Program,
  programFromPhoto,
  type RefineResult,
  readBrief,
  type Scene,
} from "@icarus/core";
import { fromFloorPlan, type SpatialModel } from "@icarus/spatial/model";
import type { ModelTrace } from "./designLoop";

export interface Design {
  program: Program;
  plan: FloorPlan;
  seed: number;
  /** What the brief reader stated or assumed, one sentence each. */
  notes: string[];
}

/** How a design came about: what the model decided, what the checks found, what was repaired. */
export interface DesignTrace extends ModelTrace {
  rounds: RefineResult["rounds"];
  suggestions: RefineResult["suggestions"];
  startOpen: number;
  endOpen: number;
  startCost: number;
  endCost: number;
}

/** One typed request and what came of each operation in it, kept so the user can see what they changed. */
export interface EditEntry {
  text: string;
  /** Whether a fixed grammar or the model understood the request. */
  by: "rules" | "model";
  lines: { status: "applied" | "unchanged" | "refused" | "note"; text: string }[];
}

export interface Built extends Design {
  /**
   * The building as the spatial model sees it. Changing the design by words works on this, not on
   * the plan's stored row order, and gives a model back; the plan alongside is what is drawn.
   */
  model: SpatialModel;
  scene: Scene;
  evidence: EvidenceItem[];
  report: FurnishReport;
  plannedMs: number;
  /** Present when the design went through the propose-and-repair loop. */
  trace?: DesignTrace;
  /** Changes asked for in words since the design was made, oldest first. */
  edits?: EditEntry[];
}

/** The stages shown while building. Each one does real work, in order. */
export const STAGES = [
  "Reading the brief",
  "Asking the model what this office needs",
  "Planning, checking and repairing",
  "Building walls, furnishing and lighting",
] as const;

/** The stages shown when the office starts from a photograph. */
export const PHOTO_STAGES = [
  "Reading the photo",
  "Planning, checking and repairing",
  "Building walls, furnishing and lighting",
  "Measuring the plan",
] as const;

export function readPhotoDesign(read: PhotoRead, measured: MeasuredColours, seed = 1) {
  const { program, notes } = programFromPhoto(read, measured);
  return { program, notes, seed };
}

export function readDesign(brief: string, seed = 1): Pick<Design, "program" | "notes" | "seed"> {
  const { program, notes } = readBrief(brief);
  return { program, notes, seed };
}

export function planDesign(read: Pick<Design, "program" | "notes" | "seed">): Design {
  return { ...read, plan: layoutOffice(read.program, { seed: read.seed }) };
}

export function finish(design: Design, plannedMs: number): Built {
  const { scene, report } = furnish(design.plan, design.program);
  return {
    ...design,
    model: fromFloorPlan(design.plan, { program: design.program }),
    scene,
    report,
    evidence: [...measurePlan(design.plan, design.program), ...furnishingEvidence(report)],
    plannedMs,
  };
}

export function rebuild(program: Program, seed: number, notes: string[]): Built {
  const t = performance.now();
  const design = planDesign({ program, seed, notes });
  return finish(design, Math.round(performance.now() - t));
}

const openCount = (e: Evaluation) => e.issues.filter((i) => i.severity !== "info").length;

/** A finished design from the loop's best evaluation: nothing is planned or furnished twice. */
export function builtFromRefine(
  refine: RefineResult,
  notes: string[],
  trace: ModelTrace,
  plannedMs: number,
): Built {
  const { plan, program, seed, furnished } = refine.best;
  return {
    program,
    plan,
    seed,
    notes,
    model: fromFloorPlan(plan, { program }),
    scene: furnished.scene,
    report: furnished.report,
    evidence: [...measurePlan(plan, program), ...furnishingEvidence(furnished.report)],
    plannedMs,
    trace: {
      ...trace,
      rounds: refine.rounds,
      suggestions: refine.suggestions,
      startOpen: openCount(refine.baseline),
      endOpen: openCount(refine.best),
      startCost: refine.baseline.cost,
      endCost: refine.best.cost,
    },
  };
}

/** A design after a spoken or typed change: the measured evaluation becomes the shown design, nothing is planned twice. */
export function builtFromEvaluation(
  ev: Evaluation,
  base: Built,
  entry: EditEntry,
  model: SpatialModel = fromFloorPlan(ev.plan, { program: ev.program }),
): Built {
  return {
    ...base,
    program: ev.program,
    plan: ev.plan,
    model,
    seed: ev.seed,
    scene: ev.furnished.scene,
    report: ev.furnished.report,
    evidence: [...measurePlan(ev.plan, ev.program), ...furnishingEvidence(ev.furnished.report)],
    edits: [...(base.edits ?? []), entry],
  };
}
