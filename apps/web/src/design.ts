import {
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
  readBrief,
  type Scene,
} from "@icarus/core";

export interface Design {
  program: Program;
  plan: FloorPlan;
  seed: number;
  /** What the brief reader stated or assumed, one sentence each. */
  notes: string[];
}

export interface Built extends Design {
  scene: Scene;
  evidence: EvidenceItem[];
  report: FurnishReport;
  plannedMs: number;
}

/** The stages shown while building. Each one does real work, in order. */
export const STAGES = [
  "Reading the brief",
  "Planning the rooms and circulation",
  "Building walls, furnishing and lighting",
  "Measuring the plan",
] as const;

/** The stages shown when the office starts from a photograph. */
export const PHOTO_STAGES = [
  "Reading the photo",
  "Planning the rooms and circulation",
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
