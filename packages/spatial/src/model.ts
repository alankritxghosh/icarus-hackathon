// The part of the package a browser needs: the model type, the plan adapter and the saved-office
// upgrade. It leaves out the geometry kernel, so importing it does not load Clipper2.
export { CIRCULATION, fromFloorPlan, OFFICE, toFloorPlan } from "./adapter";
export { type DxfResult, toDxf } from "./dxf";
export { type EditState, editModel, evaluationOfModel, locksOf, type ModelEdit } from "./edit";
export { lockedSpaceIds, SAVED_VERSION, type SavedWithModel, upgradeSaved } from "./migrate";
export { planDifferences } from "./planDiff";
export type { SpatialModel } from "./schema";
