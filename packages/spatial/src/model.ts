// The part of the package a browser needs: the model type, the plan adapter and the saved-office
// upgrade. It leaves out the geometry kernel, so importing it does not load Clipper2.
export { CIRCULATION, fromFloorPlan, OFFICE, toFloorPlan } from "./adapter";
export {
  auditAgainstDrawing,
  type DrawingAudit,
  type DrawingEvidence,
} from "./drawingAudit";
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
export type { SpatialModel } from "./schema";
export { estimateUnitMm, extractEvidenceAuto, type ScaleEstimate } from "./sheetScale";
