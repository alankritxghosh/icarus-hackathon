export { snapPlanToMm } from "@icarus/core";
export {
  type BackConversion,
  CIRCULATION,
  fromFloorPlan,
  OFFICE,
  toFloorPlan,
} from "./adapter";
export { circulationGraph } from "./circulation";
export { type DxfResult, toDxf } from "./dxf";
export * from "./geometry";
export { createKernel, type Kernel } from "./kernel";
export { lockedSpaceIds, SAVED_VERSION, type SavedWithModel, upgradeSaved } from "./migrate";
export { modelEvidence } from "./modelEvidence";
export { isInside, sharedBoundaryLength } from "./predicates";
export * from "./schema";
export { uncertaintySummary } from "./uncertainty";
export { type Finding, usableAreaM2, validate } from "./validate";
