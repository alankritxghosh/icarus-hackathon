import { type Furnished, furnish } from "../furnish";
import { type LayoutOptions, layoutOffice } from "../layout";
import type { FloorPlan } from "../layout/types";
import type { Program } from "../program";
import type { Issue } from "./diagnose";
import { type Evaluation, evaluateProgram } from "./evaluate";
import { applyPatch, describePatch, type Patch, PatchSchema, shellIsStated } from "./patch";
import { repairByRules } from "./rules";
import { fitShell, type Suggestion, suggestFixes } from "./suggest";

/** Something that can suggest a revision. A model implements it; failing is allowed and handled. */
export interface Advisor {
  revise?(context: { program: Program; issues: Issue[]; round: number }): Promise<unknown>;
}

export interface Round {
  round: number;
  source: "start" | "model" | "rules";
  /** What was tried, in words. */
  description: string;
  reason?: string;
  patch?: Patch;
  accepted: boolean;
  cost: number;
  /** Warnings and failures left after this try. */
  open: number;
  note?: string;
}

export interface RefineResult {
  best: Evaluation;
  baseline: Evaluation;
  rounds: Round[];
  /** Changes to the user's own facts that would fix what the loop could not. Never applied automatically. */
  suggestions: Suggestion[];
}

const actionable = (issues: Issue[]) => issues.filter((i) => i.severity !== "info");

/**
 * Close the loop: measure the plan, ask for a change, re-plan, and keep the change only if the
 * measured cost fell. The advisor (a model) proposes through a closed set of operations; when it
 * is absent, fails or proposes nothing useful, the rule-based repairer takes over. The facts the
 * user stated are never touched, and the result is never worse than the starting plan.
 */
export async function refineDesign(
  program: Program,
  options: {
    advisor?: Advisor;
    maxRounds?: number;
    seeds?: number[];
    layout?: LayoutOptions;
    onRound?: (round: Round) => void;
  } = {},
): Promise<RefineResult> {
  const evalOptions = { seeds: options.seeds ?? [1, 2], layout: options.layout };
  const baseline = evaluateProgram(program, evalOptions);
  let best = baseline;
  const rounds: Round[] = [
    {
      round: 0,
      source: "start",
      description: "First plan from the program",
      accepted: true,
      cost: best.cost,
      open: actionable(best.issues).length,
    },
  ];
  options.onRound?.(rounds[0] as Round);

  for (let round = 1; round <= (options.maxRounds ?? 3); round++) {
    if (actionable(best.issues).length === 0) break;
    const attempts: { source: "model" | "rules"; patch: Patch; note?: string }[] = [];
    let note: string | undefined;
    if (options.advisor?.revise) {
      try {
        const raw = await options.advisor.revise({
          program: best.program,
          issues: best.issues,
          round,
        });
        const parsed = PatchSchema.safeParse(raw);
        if (parsed.success && parsed.data.ops.length)
          attempts.push({ source: "model", patch: parsed.data });
        else
          note = parsed.success
            ? "The model proposed no change."
            : "The model's proposal was not valid, so it was ignored.";
      } catch {
        note = "The model could not be reached.";
      }
    }
    const rules = repairByRules(best.issues, best.plan);
    if (rules.ops.length) attempts.push({ source: "rules", patch: rules });

    let improved = false;
    for (const attempt of attempts) {
      const candidate = evaluateProgram(applyPatch(best.program, attempt.patch), evalOptions);
      const refusedShell =
        attempt.patch.ops.some((o) => o.op === "grow_shell") && shellIsStated(best.program);
      const accepted = candidate.cost < best.cost - 0.01;
      const entry: Round = {
        round,
        source: attempt.source,
        description: describePatch(attempt.patch),
        reason: attempt.patch.reason,
        patch: attempt.patch,
        accepted,
        cost: candidate.cost,
        open: actionable(candidate.issues).length,
        note: refusedShell
          ? "The brief states the shell size, so it was not enlarged."
          : attempt.source === "model"
            ? note
            : undefined,
      };
      rounds.push(entry);
      options.onRound?.(entry);
      if (accepted) {
        best = candidate;
        improved = true;
        break;
      }
    }
    if (!attempts.length) {
      const entry: Round = {
        round,
        source: "rules",
        description: "No change is available",
        accepted: false,
        cost: best.cost,
        open: actionable(best.issues).length,
        note,
      };
      rounds.push(entry);
      options.onRound?.(entry);
      break;
    }
    if (!improved) break;
  }
  // A shell that was only assumed can simply be sized properly: try enlargements and keep the best.
  if (!shellIsStated(best.program) && actionable(best.issues).length >= 3) {
    const grown = fitShell(best.program, { seeds: evalOptions.seeds });
    const accepted = !!grown && grown.evaluation.cost < best.cost - 0.01;
    if (grown) {
      const entry: Round = {
        round: rounds.length,
        source: "rules",
        description: `enlarge the shell to ${grown.widthM} x ${grown.depthM} m (planned and checked)`,
        reason: "The shell size was assumed, not stated, so it was sized to fit the rooms.",
        accepted,
        cost: grown.evaluation.cost,
        open: actionable(grown.evaluation.issues).length,
      };
      rounds.push(entry);
      options.onRound?.(entry);
      if (accepted) best = grown.evaluation;
    }
  }
  return { best, baseline, rounds, suggestions: suggestFixes(best.program, best.issues, best) };
}
