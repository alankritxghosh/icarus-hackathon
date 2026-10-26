import { z } from "zod";
import data from "./office.v1.json";

export const ROOM_KINDS = [
  "open_workspace",
  "meeting_room",
  "private_office",
  "kitchen",
  "lounge",
  "reception",
  "storage",
  "server_room",
  "restroom",
] as const;
export type RoomKind = (typeof ROOM_KINDS)[number];

const Kind = z.enum(ROOM_KINDS);
const Positive = z.number().positive();

const RoomKnowledge = z.object({
  label: z.string(),
  minWidthM: Positive,
  minDepthM: Positive,
  maxAspect: Positive,
  daylight: z.enum(["required", "preferred", "avoid", "none"]),
  minScale: z.number().min(0.3).max(1),
  adjacent: z.array(Kind),
  area: z.object({
    basis: z.string(),
    baseM2: z.number().min(0),
    perPersonM2: z.number().min(0).optional(),
    perSeatM2: z.number().min(0).optional(),
    minM2: z.number().min(0).optional(),
  }),
  source: z.string(),
});

/**
 * The spatial knowledge Icarus plans with, as validated data: one source that the solver, the
 * validator and the model's instructions all read, so they cannot drift apart. Every entry names
 * where it comes from, and the whole file says it is not a code check.
 */
export const KnowledgeSchema = z.object({
  version: z.literal(1),
  scope: z.string(),
  references: z.array(z.object({ id: z.string(), text: z.string(), url: z.string().optional() })),
  rooms: z.object(
    Object.fromEntries(ROOM_KINDS.map((k) => [k, RoomKnowledge])) as Record<
      RoomKind,
      typeof RoomKnowledge
    >,
  ),
  circulation: z.object({
    corridorWidthM: Positive,
    lobbyWidthM: Positive,
    entranceWidthM: Positive,
    minClearRouteM: Positive,
    minDoorClearM: Positive,
    doorClearanceM: Positive,
    source: z.string(),
  }),
  workstation: z.object({
    deskWidthsM: z.array(Positive).min(1),
    deskDepthM: Positive,
    chairReachM: Positive,
    chairClearanceM: Positive,
    modulePitchM: Positive,
    source: z.string(),
  }),
  thresholds: z.object({
    workspacePerPersonOkM2: Positive,
    workspacePerPersonWarnM2: Positive,
    oversizeRatio: z.number().min(1),
    source: z.string(),
  }),
});
export type Knowledge = z.infer<typeof KnowledgeSchema>;

/** Parse the shipped knowledge, and refuse a file whose entries cite a source it does not list. */
export function loadKnowledge(raw: unknown = data): Knowledge {
  const k = KnowledgeSchema.parse(raw);
  for (const kind of ROOM_KINDS)
    if (!k.references.some((r) => r.id === k.rooms[kind].source))
      throw new Error(`knowledge: ${kind} cites an unknown source "${k.rooms[kind].source}"`);
  if (k.thresholds.workspacePerPersonWarnM2 > k.thresholds.workspacePerPersonOkM2)
    throw new Error("knowledge: the warn threshold must not exceed the ok threshold");
  return k;
}

export const KNOWLEDGE: Knowledge = loadKnowledge();

/** The same knowledge as short plain text, for a model's instructions. */
export function describeKnowledge(k: Knowledge = KNOWLEDGE): string {
  const lines = ROOM_KINDS.map((kind) => {
    const r = k.rooms[kind];
    const wants = r.adjacent.length ? `; wants to be next to: ${r.adjacent.join(", ")}` : "";
    return `- ${kind}: ${r.area.basis}; at least ${r.minWidthM} x ${r.minDepthM} m; daylight ${r.daylight}${wants}`;
  });
  return [
    "Planning rules of thumb (concept design only, not a building code):",
    ...lines,
    `- corridors ${k.circulation.corridorWidthM} m, entrance lobby ${k.circulation.lobbyWidthM} m, door clearance ${k.circulation.doorClearanceM} m`,
    `- workspace should offer at least ${k.thresholds.workspacePerPersonOkM2} m2 per person`,
  ].join("\n");
}
