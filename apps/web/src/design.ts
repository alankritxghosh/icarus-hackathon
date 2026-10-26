import {
  buildShell,
  type EvidenceItem,
  type FloorPlan,
  layoutOffice,
  measurePlan,
  type Program,
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
  plannedMs: number;
}

/** The stages shown while building. Each one does real work, in order. */
export const STAGES = [
  "Reading the brief",
  "Planning the rooms and circulation",
  "Building walls, doors and windows",
  "Measuring the plan",
] as const;

export function readDesign(brief: string, seed = 1): Pick<Design, "program" | "notes" | "seed"> {
  const { program, notes } = readBrief(brief);
  return { program, notes, seed };
}

export function planDesign(read: Pick<Design, "program" | "notes" | "seed">): Design {
  return { ...read, plan: layoutOffice(read.program, { seed: read.seed }) };
}

export function finish(design: Design, plannedMs: number): Built {
  return {
    ...design,
    scene: buildShell(design.plan),
    evidence: measurePlan(design.plan, design.program),
    plannedMs,
  };
}

export function rebuild(program: Program, seed: number, notes: string[]): Built {
  const t = performance.now();
  const design = planDesign({ program, seed, notes });
  return finish(design, Math.round(performance.now() - t));
}
