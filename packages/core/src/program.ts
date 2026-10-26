import { z } from "zod";
import { AREA_RULES, KIND_RULES, ROOM_KINDS, type RoomKind } from "./catalog";

export const SideSchema = z.enum(["north", "south", "east", "west"]);

export const ShellSchema = z.object({
  widthM: z.number().min(6).max(80),
  depthM: z.number().min(6).max(80),
  ceilingM: z.number().min(2.4).max(6).default(2.9),
  /** Walls with glazing. */
  windows: z.array(SideSchema).default([]),
  entrance: SideSchema,
});

export const RoomRequestSchema = z.object({
  kind: z.enum(ROOM_KINDS),
  count: z.int().min(1).max(12).default(1),
  /** Seats, for meeting rooms. */
  capacity: z.int().min(2).max(30).optional(),
  /** Overrides the catalog rule when the brief states a size. */
  areaM2: z.number().min(2).max(500).optional(),
  name: z.string().max(60).optional(),
});

export const AssumptionSchema = z.object({
  topic: z.string(),
  statement: z.string(),
  source: z.enum(["brief", "catalog", "model"]),
  confidence: z.number().min(0).max(1),
});

export const ProgramSchema = z.object({
  company: z.object({ name: z.string().max(80).optional(), headcount: z.int().min(2).max(500) }),
  shell: ShellSchema,
  rooms: z.array(RoomRequestSchema).min(1).max(40),
  /** Free pods placed inside the open workspace, not planned as rooms. */
  phoneBooths: z.int().min(0).max(12).default(0),
  assumptions: z.array(AssumptionSchema).default([]),
});

export type Program = z.infer<typeof ProgramSchema>;
export type Shell = z.infer<typeof ShellSchema>;
export type RoomRequest = z.infer<typeof RoomRequestSchema>;
export type Assumption = z.infer<typeof AssumptionSchema>;

/** One room to be planned, with its target size and the rule that produced it. */
export interface PlannedRoom {
  id: string;
  kind: RoomKind;
  name: string;
  targetAreaM2: number;
  /** Why this target: the brief, or the catalog rule. */
  basis: string;
  capacity?: number;
}

const LABEL_NUMBERED = new Set<RoomKind>(["meeting_room", "private_office", "restroom", "storage"]);

/** Expand counts into individual rooms with ids and target areas. Pure and deterministic. */
export function expandRooms(program: Program): PlannedRoom[] {
  const rooms: PlannedRoom[] = [];
  const n = program.company.headcount;
  const seen = new Map<RoomKind, number>();
  for (const request of program.rooms) {
    for (let i = 0; i < request.count; i++) {
      const index = (seen.get(request.kind) ?? 0) + 1;
      seen.set(request.kind, index);
      const capacity = request.kind === "meeting_room" ? (request.capacity ?? 6) : request.capacity;
      const rule = AREA_RULES[request.kind];
      const stated = request.areaM2 !== undefined;
      const base = KIND_RULES[request.kind].label;
      const name =
        request.name ??
        (LABEL_NUMBERED.has(request.kind) && (request.count > 1 || index > 1)
          ? `${base} ${index}`
          : base);
      rooms.push({
        id: `${request.kind}.${index}`,
        kind: request.kind,
        name: request.count > 1 && request.name ? `${request.name} ${i + 1}` : name,
        targetAreaM2: stated
          ? (request.areaM2 as number)
          : Math.round(rule.area(n, capacity ?? 0) * 10) / 10,
        basis: stated ? "stated in the brief" : rule.basis,
        capacity,
      });
    }
  }
  return rooms;
}

/** Problems that make a program unusable, as text. Empty means the program can be planned. */
export function checkProgram(program: Program): string[] {
  const problems: string[] = [];
  const kinds = new Set(program.rooms.map((r) => r.kind));
  if (!kinds.has("open_workspace") && !kinds.has("private_office"))
    problems.push("The program has no workspace: add an open workspace or private offices.");
  if (!kinds.has("restroom")) problems.push("The program has no restroom.");
  const planned = expandRooms(program);
  const needed = planned.reduce((s, r) => s + r.targetAreaM2, 0);
  const shell = program.shell.widthM * program.shell.depthM;
  const minimum = planned.reduce((s, r) => s + r.targetAreaM2 * KIND_RULES[r.kind].minScale, 0);
  if (minimum > shell * 0.92)
    problems.push(
      `The rooms need at least ${Math.round(minimum)} m2 even at their smallest, but the shell is ${Math.round(shell)} m2 with no space left for circulation.`,
    );
  else if (needed > shell)
    problems.push(
      `The program asks for ${Math.round(needed)} m2 but the shell is ${Math.round(shell)} m2; rooms will be scaled down.`,
    );
  return problems;
}
