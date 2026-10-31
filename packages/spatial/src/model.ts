// The part of the package a browser needs: the model type, the plan adapter and the saved-office
// upgrade. It leaves out the geometry kernel, so importing it does not load Clipper2.

export {
  ACCOUNT_LESSONS_VERSION,
  AccountLesson,
  AccountLessons,
  kindMatches,
  parseAccountLessons,
  ruleFromWords,
  teach,
} from "./accountLessons";
export { CIRCULATION, fromFloorPlan, OFFICE, toFloorPlan } from "./adapter";
export {
  auditAgainstDrawing,
  type DrawingAudit,
  type DrawingEvidence,
} from "./drawingAudit";
export { type DrawingEditResult, type DrawingMove, moveDrawingWall } from "./drawingEdit";
export { type DxfResult, toDxf } from "./dxf";
export { type EditState, editModel, evaluationOfModel, locksOf, type ModelEdit } from "./edit";
export { type FromDrawingOptions, type FromDrawingReport, modelFromEvidence } from "./fromDrawing";
export { checkLessons } from "./lessons";
export { lockedSpaceIds, SAVED_VERSION, type SavedWithModel, upgradeSaved } from "./migrate";
export {
  alignEvidenceToModel,
  type ExtractedEvidence,
  extractEvidence,
  unitMmFromScale,
} from "./pdfEvidence";
export { planDifferences } from "./planDiff";
export {
  type Decision,
  type PrincipleReview,
  type Profile,
  profileOf,
  reviewAgainstPrinciples,
} from "./principles";
export { type DrawnScene, sceneFromModel } from "./sceneFromModel";
export { SpatialModel } from "./schema";
export { estimateUnitMm, extractEvidenceAuto, type ScaleEstimate } from "./sheetScale";
