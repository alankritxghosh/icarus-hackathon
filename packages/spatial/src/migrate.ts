// Upgrading a saved office to carry its spatial model.
//
// A saved office today is a Program (which holds the solver's row order in `arrangement` and the
// locks as centre points) plus the FloorPlan it produced. Version 2 adds the spatial model, where a
// lock is a flag on a space and the geometry is stored directly, so nothing needs the row order to
// be reproduced. The Program is kept untouched as the brief and the generator's input; the model is
// derived from the plan, so the upgrade can run on any old save and can run twice.
import type { FloorPlan, Program } from "@icarus/core";
import { fromFloorPlan } from "./adapter";
import type { SpatialModel } from "./schema";

export const SAVED_VERSION = 2;

export interface SavedWithModel {
  version: typeof SAVED_VERSION;
  program: Program;
  plan: FloorPlan;
  model: SpatialModel;
}

export function upgradeSaved<
  T extends { program: Program; plan: FloorPlan; version?: number; model?: SpatialModel },
>(saved: T, name?: string): Omit<T, "version" | "model"> & SavedWithModel {
  const model =
    saved.version === SAVED_VERSION && saved.model
      ? saved.model
      : fromFloorPlan(saved.plan, { program: saved.program, name });
  return { ...saved, version: SAVED_VERSION, model };
}

/** Rooms the user has locked, by id, read from the model instead of from centre points. */
export const lockedSpaceIds = (model: SpatialModel): string[] =>
  model.spaces.filter((s) => s.locked).map((s) => s.id);
