import { type Furnished, furnish } from "../furnish";
import { type LayoutOptions, layoutOffice } from "../layout";
import type { FloorPlan } from "../layout/types";
import type { Program } from "../program";
import { diagnose, type Issue, issueCost } from "./diagnose";

export interface Evaluation {
  program: Program;
  plan: FloorPlan;
  furnished: Furnished;
  issues: Issue[];
  /** The repair score (lower is better); see `issueCost`. */
  cost: number;
  seed: number;
}

/** Plan, furnish and measure a program with each seed, and keep the best by measured issues. */
export function evaluateProgram(
  program: Program,
  options: { seeds?: number[]; layout?: LayoutOptions } = {},
): Evaluation {
  let best: Evaluation | undefined;
  for (const seed of options.seeds ?? [1]) {
    const plan = layoutOffice(program, { ...options.layout, seed });
    const furnished = furnish(plan, program);
    const issues = diagnose(plan, program, furnished.report);
    // The solver's own cost breaks ties between plans with equal issues.
    const cost = issueCost(issues) + 0.01 * plan.search.cost;
    if (!best || cost < best.cost) best = { program, plan, furnished, issues, cost, seed };
  }
  if (!best) throw new Error("evaluateProgram needs at least one seed");
  return best;
}
