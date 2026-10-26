import type { Program } from "../program";
import { EDIT_EXAMPLE, type EditOp } from "./ops";
import { mentionsRoom } from "./rooms";

export type Understood =
  | { kind: "edit"; ops: EditOp[]; notes: string[] }
  | { kind: "undo" }
  | { kind: "unknown"; understood: EditOp[]; rest: string[] };

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  a: 1,
  an: 1,
  another: 1,
};
const ORDINAL_TOTAL: Record<string, number> = {
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  fifth: 5,
  "5th": 5,
  sixth: 6,
  "6th": 6,
};

const VERBS =
  "move|put|shift|relocate|place|push|slide|add|include|install|remove|delete|swap|switch|exchange|trade|lock|unlock|pin|unpin|take|get|drop|keep|make|change|paint|colour|color|turn|set|rename|resize|enlarge|shrink|grow|expand|reduce|increase";
const SPLIT = new RegExp(
  `\\s*(?:;|,|\\band then\\b|\\bthen\\b|\\balso\\b|\\band\\b(?=\\s+(?:${VERBS})\\b))\\s*`,
);
const BOOTH = /\b(?:phone|call|focus)\s+(?:booths?|pods?)\b/;
const SIDE = "(north|south|east|west)(?:ern)?";

const tidy = (text: string) =>
  text
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .replace(
      /^(?:(?:please|can you|could you|would you|i want to|i'd like to|let's|lets)\s+)+/g,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();

function boothOp(clause: string, have: number): { ops: EditOp[]; note?: string } | undefined {
  if (!BOOTH.test(clause)) return undefined;
  const removing = /^(?:remove|delete|take out|get rid of|drop)\b/.test(clause);
  const adding =
    /^(?:add|include|install|get|put in|build|give|we need|i need|i want)\b|\banother\b|\bone more\b/.test(
      clause,
    );
  if (!removing && !adding) return undefined;
  const ordinal = clause.match(/\b(second|third|fourth|fifth|sixth|2nd|3rd|4th|5th|6th)\b/)?.[1];
  const counted = clause.match(
    /\b(\d+|one|two|three|four|five|six|an?|another)\s+(?:more\s+|extra\s+|additional\s+)?(?:phone|call|focus)\b/,
  )?.[1];
  if (removing) {
    const n = counted
      ? /^\d+$/.test(counted)
        ? Number(counted)
        : (NUMBER_WORDS[counted] ?? 1)
      : 1;
    return { ops: [{ op: "remove_phone_booths", count: Math.min(6, Math.max(1, n)) }] };
  }
  if (ordinal) {
    const total = ORDINAL_TOTAL[ordinal] ?? have + 1;
    const need = total - have;
    if (need <= 0)
      return {
        ops: [],
        note: `There ${have === 1 ? "is" : "are"} already ${have} phone booth${have === 1 ? "" : "s"}, so a ${ordinal} needs no change.`,
      };
    return { ops: [{ op: "add_phone_booths", count: Math.min(6, need) }] };
  }
  const n = counted ? (/^\d+$/.test(counted) ? Number(counted) : (NUMBER_WORDS[counted] ?? 1)) : 1;
  return { ops: [{ op: "add_phone_booths", count: Math.min(6, Math.max(1, n)) }] };
}

/** What the grammar needs to know about the design: the booth count and the names rooms go by. */
export interface WordsContext extends Pick<Program, "phoneBooths"> {
  /** Display names of the plan's rooms, so a room the user named themselves is still recognised. */
  names?: string[];
}

function oneClause(
  clause: string,
  have: number,
  isRoom: (phrase: string) => boolean,
): { ops: EditOp[]; note?: string } | undefined {
  const booth = boothOp(clause, have);
  if (booth) return booth;
  const parsed = roomClause(clause);
  // A phrase that does not name a room is not guessed at: the clause is left for the model to read.
  const named = (...phrases: (string | undefined)[]) => phrases.every((p) => !!p && isRoom(p));
  return parsed?.rooms.every((p) => named(p)) ? parsed.result : undefined;
}

function roomClause(clause: string): { rooms: string[]; result: { ops: EditOp[] } } | undefined {
  const swap = clause.match(/^(?:swap|switch|exchange|trade)\s+(.+?)\s+(?:and|with|for|&)\s+(.+)$/);
  if (swap?.[1] && swap[2]) {
    const b = swap[2].replace(/\s+around$/, "");
    return { rooms: [swap[1], b], result: { ops: [{ op: "swap_rooms", a: swap[1], b }] } };
  }

  const unlock = clause.match(/^(?:unlock|unpin|unfreeze|release)\s+(.+)$/);
  if (unlock?.[1]) {
    const all = /^(?:all|everything|all rooms|every room)$/.test(unlock[1]);
    return {
      rooms: all ? [] : [unlock[1]],
      result: { ops: [{ op: "unlock_room", room: all ? "all" : unlock[1] }] },
    };
  }

  const lock = clause.match(/^(?:lock|pin|freeze)\s+(.+?)(?:\s+(?:in place|where it is))?$/);
  if (lock?.[1]) return { rooms: [lock[1]], result: { ops: [{ op: "lock_room", room: lock[1] }] } };
  const keep = clause.match(/^keep\s+(.+?)\s+(?:in place|where it is|fixed)$/);
  if (keep?.[1]) return { rooms: [keep[1]], result: { ops: [{ op: "lock_room", room: keep[1] }] } };

  const move = clause.match(
    new RegExp(
      `^(?:move|put|shift|relocate|place|push|slide)\\s+(.+?)\\s+(?:(?:over\\s+)?(?:to|toward|towards|into|in|on|at)\\s+)?(?:the\\s+)?${SIDE}(?:\\s+(?:side|end|part|wall|half|corner))?(?:\\s+of the (?:office|floor|space|building|plan))?$`,
    ),
  );
  if (move?.[1] && move[2])
    return {
      rooms: [move[1]],
      result: { ops: [{ op: "move_room", room: move[1], to: move[2] as "north" }] },
    };
  return undefined;
}

/**
 * Read a typed instruction with a small fixed grammar, no model needed. It covers moving, swapping,
 * phone booths, locking and undo. Anything else is "unknown" and can go to a model, which must
 * answer in the same closed operations.
 */
export function understandEdit(text: string, context: WordsContext): Understood {
  const names = new Set((context.names ?? []).map((n) => n.toLowerCase()));
  const isRoom = (phrase: string) =>
    mentionsRoom(phrase) || names.has(phrase.toLowerCase().replace(/^(?:the|my|our)\s+/, ""));
  const whole = tidy(text);
  if (/^(?:undo(?: that| the last change| last change)?|go back|revert(?: that)?)$/.test(whole))
    return { kind: "undo" };
  const clauses = whole
    .split(SPLIT)
    .map((c) => tidy(c))
    .filter(Boolean);
  const ops: EditOp[] = [];
  const notes: string[] = [];
  const rest: string[] = [];
  let have = context.phoneBooths;
  for (const clause of clauses) {
    const parsed = oneClause(clause, have, isRoom);
    if (!parsed) {
      rest.push(clause);
      continue;
    }
    for (const op of parsed.ops) {
      ops.push(op);
      if (op.op === "add_phone_booths") have += op.count;
      if (op.op === "remove_phone_booths") have = Math.max(0, have - op.count);
    }
    if (parsed.note) notes.push(parsed.note);
  }
  if (rest.length > 0 || (ops.length === 0 && notes.length === 0))
    return { kind: "unknown", understood: ops, rest: rest.length ? rest : [whole] };
  return { kind: "edit", ops: ops.slice(0, 4), notes };
}

export interface EditContext {
  program: Program;
  rooms: { id: string; name: string; x: number; y: number }[];
  shell: { w: number; h: number };
}

/** Instructions for a model that turns a free-form request into the closed operations. */
export function editInstructions(): string {
  return `You turn one request about an existing office plan into editing operations. You do not design anything.

Answer with JSON only, in exactly this shape:
{"ops": [ ... up to 4 operations ... ], "unsupported": "optional short sentence"}

The only operations that exist:
- {"op":"move_room","room":"<room id or name>","to":"north"|"south"|"east"|"west"}  put a room in that part of the office
- {"op":"swap_rooms","a":"<room>","b":"<room>"}  exchange two rooms' positions
- {"op":"add_phone_booths","count":1..6}  add that many phone booths
- {"op":"remove_phone_booths","count":1..6}  remove that many phone booths
- {"op":"lock_room","room":"<room>"}  keep a room where it is
- {"op":"unlock_room","room":"<room>"} or {"op":"unlock_room","room":"all"}

Rules:
- Refer to rooms by the id or name listed in the input. Compass directions are real directions on the plan: north is the top, east is the right.
- "add a third phone booth" when there are 2 means add_phone_booths with count 1: use the current count given in the input.
- If the request needs anything else (adding or removing rooms, resizing, colours, the shell), return "ops": [] and say in "unsupported" what cannot be done. Never invent an operation.
- Do not give coordinates or sizes.

Example answer:
${JSON.stringify(EDIT_EXAMPLE)}`;
}

export function editInput(text: string, ctx: EditContext): string {
  const rooms = ctx.rooms
    .map((r) => `${r.id} "${r.name}" centre ${r.x} m east, ${r.y} m south of the north-west corner`)
    .join("\n");
  const locked = ctx.program.locks.length ? ctx.program.locks.map((l) => l.id).join(", ") : "none";
  return `Shell: ${ctx.shell.w} m wide (east-west) by ${ctx.shell.h} m deep (north-south).
Phone booths now: ${ctx.program.phoneBooths}.
Locked rooms: ${locked}.
Rooms:
${rooms}

Request: ${text.slice(0, 400)}`;
}
