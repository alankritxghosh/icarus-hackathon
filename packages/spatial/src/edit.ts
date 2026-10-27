// Editing by words, on the model. A request comes in as closed operations (move, swap, resize, add,
// remove, booths, lock) and the answer is a model plus a program, never a stored row order.
//
// The measuring, the refusals and the explanations are still core's `applyEdit`: it plans every
// candidate arrangement and keeps one only if it does what was asked, holds every lock and breaks
// nothing. What moves is what it works on. Before, it was handed an evaluation held at the plan's
// stored row order; now the order is read back from the geometry of the model (`arrangementOf`),
// the locks come from the spaces that carry them, and the result is converted back to a model.
import {
  applyEdit,
  arrangementOf,
  type EditOp,
  type EditOutcome,
  type Evaluation,
  evaluateProgram,
  type Program,
} from "@icarus/core";
import { fromFloorPlan, toFloorPlan } from "./adapter";
import { planDifferences } from "./planDiff";
import type { SpatialModel } from "./schema";

export interface EditState {
  /** The brief: what was asked for, preferences, what the user said. Geometry is not in it. */
  program: Program;
  /** The building. Authoritative for geometry and for which rooms are locked and where. */
  model: SpatialModel;
  /** The seed the plan was made with, kept so measuring again reproduces it. */
  seed: number;
}

export type ModelEdit =
  | { ok: false; reason: string }
  | {
      ok: true;
      /** Core's account of each operation: applied, unchanged or refused, with the reason. */
      outcome: EditOutcome;
      /** The state after the edit; the same objects that went in when nothing changed. */
      state: EditState;
      /** The measured evaluation of the new state, for screens that show scene and evidence. */
      evaluation: Evaluation;
    };

/** Locks as the edit engine reads them, taken from the spaces that carry them. */
export function locksOf(model: SpatialModel): Program["locks"] {
  return model.spaces
    .filter((s) => s.locked)
    .map((s) => {
      const xs = s.boundary.outer.map((v) => v.x);
      const ys = s.boundary.outer.map((v) => v.y);
      const at = s.lockAt ?? {
        x: (Math.min(...xs) + Math.max(...xs)) / 2,
        y: (Math.min(...ys) + Math.max(...ys)) / 2,
      };
      return { id: s.id, x: at.x / 1000, y: at.y / 1000 };
    });
}

/**
 * The measured evaluation of a model, or the reason it cannot be edited by words. The layout
 * engine makes plans of rows; a model that is not one (curves, columns, rooms moved by hand) is
 * refused here rather than edited wrongly.
 */
export function evaluationOfModel(
  state: EditState,
): { ok: true; evaluation: Evaluation } | { ok: false; reason: string } {
  const back = toFloorPlan(state.model);
  if (back.unsupported.length)
    return {
      ok: false,
      reason: `This office has things the word editor cannot move yet: ${back.unsupported.join("; ")}.`,
    };
  const rows = arrangementOf(back.plan);
  const evaluation = evaluateProgram(
    { ...state.program, arrangement: rows, locks: locksOf(state.model) },
    { seeds: [state.seed] },
  );
  const diffs = planDifferences(back.plan, evaluation.plan);
  if (diffs.length)
    return {
      ok: false,
      reason: `This office is not laid out in rows the word editor knows (${diffs[0]}), so it was left alone.`,
    };
  return { ok: true, evaluation };
}

export function editModel(
  state: EditState,
  ops: EditOp[],
  options: { base?: Evaluation } = {},
): ModelEdit {
  // A caller that has just called `evaluationOfModel` on this very state can pass its result in.
  const base = options.base
    ? { ok: true as const, evaluation: options.base }
    : evaluationOfModel(state);
  if (!base.ok) return base;
  const outcome = applyEdit(base.evaluation, ops);
  if (!outcome.changed) return { ok: true, outcome, state, evaluation: base.evaluation };
  const evaluation = outcome.evaluation;
  return {
    ok: true,
    outcome,
    evaluation,
    state: {
      program: evaluation.program,
      seed: evaluation.seed,
      model: fromFloorPlan(evaluation.plan, {
        program: evaluation.program,
        name: state.model.name,
      }),
    },
  };
}
