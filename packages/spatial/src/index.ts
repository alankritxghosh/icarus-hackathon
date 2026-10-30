export { snapPlanToMm } from "@icarus/core";
export {
  type BackConversion,
  CIRCULATION,
  fromFloorPlan,
  OFFICE,
  toFloorPlan,
} from "./adapter";
export { circulationGraph } from "./circulation";
export {
  auditAgainstDrawing,
  type DrawingAudit,
  type DrawingEvidence,
  type DrawingLabel,
  EXPECTED_CONTENTS,
  type Rect,
} from "./drawingAudit";
export { type DxfResult, toDxf } from "./dxf";
export { type EditState, editModel, evaluationOfModel, locksOf, type ModelEdit } from "./edit";
export * from "./geometry";
export { createKernel, type Kernel } from "./kernel";
export { checkLessons, LESSONS, type Lesson } from "./lessons";
export { lockedSpaceIds, SAVED_VERSION, type SavedWithModel, upgradeSaved } from "./migrate";
export { modelEvidence } from "./modelEvidence";
export { planDifferences } from "./planDiff";
export { isInside, sharedBoundaryLength } from "./predicates";
export * from "./schema";
export { uncertaintySummary } from "./uncertainty";
export { type Finding, usableAreaM2, validate } from "./validate";
