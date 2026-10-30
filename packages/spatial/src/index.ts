export { snapPlanToMm } from "@icarus/core";
export {
  ACCOUNT_LESSONS_VERSION,
  AccountLesson,
  AccountLessons,
  kindMatches,
  parseAccountLessons,
  ruleFromWords,
  teach,
} from "./accountLessons";
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
export { type FromDrawingOptions, type FromDrawingReport, modelFromEvidence } from "./fromDrawing";
export * from "./geometry";
export { createKernel, type Kernel } from "./kernel";
export { checkLessons, LESSONS, type Lesson } from "./lessons";
export { lockedSpaceIds, SAVED_VERSION, type SavedWithModel, upgradeSaved } from "./migrate";
export { modelEvidence } from "./modelEvidence";
export {
  alignEvidenceToModel,
  anchorEvidence,
  type ExtractedEvidence,
  type ExtractionReport,
  type ExtractOptions,
  extractEvidence,
  filledRects,
  parseColour,
  parsePrintedSize,
  type Rgb,
  splitPrintedSize,
  unitMmFromScale,
} from "./pdfEvidence";
export { planDifferences } from "./planDiff";
export { isInside, sharedBoundaryLength } from "./predicates";
export {
  type Decision,
  type PrincipleReview,
  type Profile,
  profileOf,
  reviewAgainstPrinciples,
} from "./principles";
export { type DrawnScene, sceneFromModel } from "./sceneFromModel";
export * from "./schema";
export { estimateUnitMm, extractEvidenceAuto, type ScaleEstimate } from "./sheetScale";
export { uncertaintySummary } from "./uncertainty";
export { type Finding, usableAreaM2, validate } from "./validate";
