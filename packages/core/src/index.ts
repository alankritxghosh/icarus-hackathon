export { type ReadBrief, readBrief } from "./brief";
export * from "./build";
export { AREA_RULES, KIND_RULES, OPPOSITE, ROOM_KINDS, type RoomKind } from "./catalog";
export { dominantColours, type MeasuredColours } from "./colour";
export { type EvidenceItem, measurePlan, reachable } from "./evidence";
export * from "./furnish";
export * from "./geometry";
export {
  describeKnowledge,
  KNOWLEDGE,
  type Knowledge,
  KnowledgeSchema,
  loadKnowledge,
} from "./knowledge";
export { type LayoutOptions, layoutOffice } from "./layout";
export * from "./layout/types";
export {
  type FromPhoto,
  PHOTO_READ_INSTRUCTIONS,
  type PhotoRead,
  PhotoReadSchema,
  programFromPhoto,
} from "./photo";
export {
  type Assumption,
  checkProgram,
  expandRooms,
  type PlannedRoom,
  type Preferences,
  PreferencesSchema,
  type Program,
  ProgramSchema,
  type RoomRequest,
  type Shell,
} from "./program";
export {
  type Merged,
  mergeProposal,
  PATCH_EXAMPLE,
  PROPOSAL_EXAMPLE,
  type Proposal,
  ProposalSchema,
  proposeInput,
  proposeInstructions,
  reviseInput,
  reviseInstructions,
} from "./propose/proposal";
export {
  type Calibration,
  calibrateRoom,
  fitRoom,
  type RoomFit,
  type Wall,
} from "./reconstruct/fit";
export {
  decodeGeometry,
  type GeometryJson,
  GeometrySchema,
  type PointCloud,
} from "./reconstruct/geometry";
export * from "./repair";
export {
  applyStyle,
  colourName,
  describeStyle,
  FLOORS,
  type FloorKind,
  type Style,
  StyleSchema,
} from "./style";
export { EYE_HEIGHT_M, type Viewpoint, viewpoints } from "./viewpoints";
