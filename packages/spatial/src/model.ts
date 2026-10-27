// The part of the package a browser needs: the model type, the plan adapter and the saved-office
// upgrade. It leaves out the geometry kernel, so importing it does not load Clipper2.
export { CIRCULATION, fromFloorPlan, OFFICE, toFloorPlan } from "./adapter";
export { type DxfResult, toDxf } from "./dxf";
export { lockedSpaceIds, SAVED_VERSION, type SavedWithModel, upgradeSaved } from "./migrate";
export type { SpatialModel } from "./schema";
