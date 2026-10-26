export * from "./build";
export { AREA_RULES, KIND_RULES, OPPOSITE, ROOM_KINDS, type RoomKind } from "./catalog";
export { type EvidenceItem, measurePlan, reachable } from "./evidence";
export * from "./geometry";
export { type LayoutOptions, layoutOffice } from "./layout";
export * from "./layout/types";
export {
  type Assumption,
  checkProgram,
  expandRooms,
  type PlannedRoom,
  type Program,
  ProgramSchema,
  type RoomRequest,
  type Shell,
} from "./program";
