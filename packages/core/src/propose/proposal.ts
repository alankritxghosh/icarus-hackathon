import { z } from "zod";
import type { ReadBrief } from "../brief";
import { ROOM_KINDS, type RoomKind } from "../catalog";
import { describeKnowledge } from "../knowledge";
import {
  type Assumption,
  type Preferences,
  PreferencesSchema,
  type Program,
  ProgramSchema,
} from "../program";
import type { Issue } from "../repair";

const ADDABLE = [
  "lounge",
  "private_office",
  "storage",
  "server_room",
  "kitchen",
  "reception",
] as const;

/**
 * What a model may add to a brief. It fills what the user left open (counts the brief did not
 * state, extra rooms a company like this would want, how rooms should relate) and explains each
 * decision. It cannot override a stated fact; `mergeProposal` enforces that, not the prompt.
 */
export const ProposalSchema = z.object({
  meetingRooms: z.int().min(0).max(8).optional(),
  meetingCapacity: z.int().min(2).max(20).optional(),
  phoneBooths: z.int().min(0).max(12).optional(),
  restrooms: z.int().min(1).max(4).optional(),
  addRooms: z.array(z.enum(ADDABLE)).max(4).default([]),
  preferences: PreferencesSchema.default(() => PreferencesSchema.parse({})),
  decisions: z
    .array(
      z.object({
        topic: z.string().max(40),
        choice: z.string().max(80),
        reason: z.string().max(200),
      }),
    )
    .max(8)
    .default([]),
});
export type Proposal = z.infer<typeof ProposalSchema>;

export interface Merged {
  program: Program;
  /** Each decision the model made, for the design trace. */
  decisions: Proposal["decisions"];
  /** What the model asked for and was refused, with the reason. */
  ignored: string[];
}

const catalogAssumed = (program: Program, topic: string) =>
  program.assumptions.some((a) => a.topic === topic && a.source === "catalog");

/**
 * Fold a proposal into the program the deterministic reader built, refusing anything that would
 * override what the brief stated. Always returns a valid program.
 */
export function mergeProposal(read: ReadBrief, proposal: Proposal): Merged {
  const ignored: string[] = [];
  let program: Program = JSON.parse(JSON.stringify(read.program));
  const rooms = program.rooms;
  const has = (kind: RoomKind) => rooms.some((r) => r.kind === kind);

  const setCount = (kind: RoomKind, count: number | undefined, topic: string, label: string) => {
    if (count === undefined) return;
    if (!catalogAssumed(program, topic)) {
      ignored.push(
        `The brief states the number of ${label}, so the proposal's ${count} was ignored.`,
      );
      return;
    }
    const entry = rooms.find((r) => r.kind === kind);
    if (count === 0) program.rooms = rooms.filter((r) => r.kind !== kind);
    else if (entry) entry.count = count;
    else rooms.push({ kind, count });
  };
  setCount("meeting_room", proposal.meetingRooms, "meeting rooms", "meeting rooms");
  setCount("restroom", proposal.restrooms, "restrooms", "restrooms");
  if (proposal.phoneBooths !== undefined) {
    if (catalogAssumed(program, "phone booths")) program.phoneBooths = proposal.phoneBooths;
    else
      ignored.push(
        "The brief states the number of phone booths, so the proposal's count was ignored.",
      );
  }
  if (proposal.meetingCapacity !== undefined) {
    const meeting = program.rooms.find((r) => r.kind === "meeting_room");
    if (meeting) meeting.capacity = proposal.meetingCapacity;
  }
  for (const kind of proposal.addRooms) {
    if (has(kind)) continue;
    program.rooms.push({ kind, count: 1 });
  }

  // Preferences may only mention kinds that exist in this program.
  const present = new Set(program.rooms.map((r) => r.kind));
  const prefs: Preferences = { adjacent: [], apart: [], areaScale: {} };
  for (const p of proposal.preferences.adjacent)
    if (present.has(p.a) && present.has(p.b) && p.a !== p.b) prefs.adjacent.push(p);
    else
      ignored.push(
        `Ignored a neighbour wish about a room this office does not have (${p.a}, ${p.b}).`,
      );
  for (const p of proposal.preferences.apart)
    if (present.has(p.a) && present.has(p.b) && p.a !== p.b) prefs.apart.push(p);
    else
      ignored.push(
        `Ignored a separation wish about a room this office does not have (${p.a}, ${p.b}).`,
      );
  for (const [kind, scale] of Object.entries(proposal.preferences.areaScale) as [
    RoomKind,
    number,
  ][])
    if (present.has(kind)) prefs.areaScale[kind] = scale;
  program.preferences = prefs;

  const decisions = proposal.decisions;
  const noted: Assumption[] = decisions.map((d) => ({
    topic: d.topic,
    statement: `${d.choice}: ${d.reason}`,
    source: "model",
    confidence: 0.5,
  }));
  program = ProgramSchema.parse({ ...program, assumptions: [...program.assumptions, ...noted] });
  return { program, decisions, ignored };
}

const KINDS = ROOM_KINDS.join(", ");

/**
 * An example of a valid answer, shown to the model in its instructions because not every provider
 * enforces a response schema. A test checks it against `ProposalSchema` so the two cannot drift.
 */
export const PROPOSAL_EXAMPLE = {
  meetingRooms: 3,
  meetingCapacity: 6,
  phoneBooths: 2,
  restrooms: 2,
  addRooms: ["lounge"],
  preferences: {
    adjacent: [{ a: "kitchen", b: "lounge", weight: 2 }],
    apart: [{ a: "server_room", b: "meeting_room", weight: 1 }],
    areaScale: { open_workspace: 1.1 },
  },
  decisions: [
    { topic: "lounge", choice: "add one", reason: "a place to reset between focused work" },
    {
      topic: "meeting rooms",
      choice: "three of six seats",
      reason: "design reviews happen in small groups",
    },
  ],
};

/** Instructions for the proposal call. The rules come from the knowledge file the solver uses. */
export function proposeInstructions(): string {
  return `You are a workplace planning assistant helping lay out an office. A deterministic solver will do the geometry, so you do NOT give coordinates or sizes. You decide what an office like this needs and how its rooms should relate.

${describeKnowledge()}

Reply with JSON only, matching the schema. Rules:
- Only set meetingRooms, meetingCapacity, phoneBooths or restrooms when the brief did not state them; the brief wins and your value will be ignored otherwise.
- addRooms: rooms a company like this would want that the brief did not list (allowed: lounge, private_office, storage, server_room, kitchen, reception). Be restrained: at most two.
- preferences.adjacent / apart: pairs of room kinds (${KINDS}) that should share a wall or stay apart, with a weight from 0.5 to 3. preferences.areaScale: optional bias from 0.6 to 1.6 for a kind.
- decisions: up to six short entries explaining your choices in plain words. Never claim a building-code requirement.

Answer with ONE JSON object and nothing else (no prose, no code fence), shaped exactly like this example. Leave out any key you have no opinion on:
${JSON.stringify(PROPOSAL_EXAMPLE)}`;
}

/** The facts the model is told, built from the deterministic read of the brief. */
export function proposeInput(brief: string, read: ReadBrief): string {
  const p = read.program;
  const counts = p.rooms.map((r) => `${r.kind} x${r.count}`).join(", ");
  return `Brief: ${brief}

Facts already read from the brief (stated unless marked assumed):
- headcount ${p.company.headcount}; shell ${p.shell.widthM} x ${p.shell.depthM} m; windows on ${p.shell.windows.join(", ") || "no wall"}; entrance on the ${p.shell.entrance} wall
- rooms so far: ${counts}; phone booths ${p.phoneBooths}
- assumed (not stated): ${
    p.assumptions
      .filter((a) => a.source === "catalog")
      .map((a) => a.topic)
      .join(", ") || "nothing"
  }`;
}

/** An example of a valid patch, kept in step with `PatchSchema` by a test. */
export const PATCH_EXAMPLE = {
  ops: [
    { op: "scale_area", kind: "kitchen", factor: 1.2 },
    { op: "prefer_adjacent", a: "lounge", b: "kitchen", weight: 2 },
  ],
  reason: "The kitchen is short and the lounge should sit beside it.",
};

/** Instructions for a revision call: the model sees measured failures and answers with a patch. */
export function reviseInstructions(): string {
  return `You are helping repair an office layout. A solver planned it and a validator measured it; you are shown what is wrong. Propose a small change from a closed set of operations, and the solver will re-plan and keep it only if the measurements improve.

${describeKnowledge()}

Reply with JSON only: {"ops": [...], "reason": "one sentence"}. Allowed ops (at most 6):
- {"op":"scale_area","kind":<room kind>,"factor":0.7-1.4}: bias how much floor a kind of room gets (give to a room that is too small, take from one that is oversized)
- {"op":"prefer_adjacent","a":<kind>,"b":<kind>,"weight":0.5-3}: ask for two kinds to share a wall
- {"op":"prefer_apart","a":<kind>,"b":<kind>,"weight":0.5-3}
- {"op":"grow_shell","factor":1.05-1.6}: only when the shell size was assumed (it is refused otherwise)
Room kinds: ${KINDS}. You cannot add or remove rooms or change headcount. Prefer the fewest changes that address the largest problems.

Answer with ONE JSON object and nothing else (no prose, no code fence), shaped exactly like this example:
${JSON.stringify(PATCH_EXAMPLE)}`;
}

export function reviseInput(program: Program, issues: Issue[], round: number): string {
  const open = issues
    .filter((i) => i.severity !== "info")
    .slice(0, 12)
    .map(
      (i) => `- [${i.severity}] ${i.code} (${i.kinds.join(", ") || "whole plan"}): ${i.message}`,
    );
  return `Round ${round}. Headcount ${program.company.headcount}, shell ${program.shell.widthM} x ${program.shell.depthM} m.
Current area bias: ${JSON.stringify(program.preferences.areaScale)}; neighbour wishes: ${JSON.stringify(program.preferences.adjacent)}.

Measured problems:
${open.join("\n") || "- none"}`;
}
