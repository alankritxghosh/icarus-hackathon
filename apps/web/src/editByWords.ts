import { centre, type Edit, EditSchema, type Evaluation, understandEdit } from "@icarus/core";
import { editModel, evaluationOfModel } from "@icarus/spatial/model";
import { type Built, builtFromEvaluation, type EditEntry } from "./design";

type Fetch = typeof fetch;

export interface EditResult {
  /** What to show the user, one line per thing that happened. */
  entry: EditEntry;
  /** The changed design, when something was applied. */
  built?: Built;
  /** True when the user asked to undo; the caller owns the history. */
  undo?: boolean;
}

const HELP =
  "I can move a room (“move the kitchen east”), make a room bigger or smaller (“make the kitchen bigger”), add or remove a meeting room (“add a meeting room”), swap two rooms (“swap the lounge and the kitchen”), change phone booths (“add a third phone booth”), and lock or unlock a room (“lock the kitchen”).";

/** A promise about unchanged rooms is a constraint on the whole edit, never another operation. */
function separateKeepRequest(text: string): { request: string; keepOthers: boolean } {
  const constraint =
    /(?:\s*(?:,|;)?\s*\b(?:and\s+)?(?:(?:keep|leave)\s+(?:everything|anything|all(?:\s+the)?\s+other\s+rooms?|the\s+(?:other\s+rooms?|rest)|every\s+other\s+room)\s+(?:else\s+)?(?:where\s+(?:it|they)\s+(?:is|are)|in\s+place|unchanged|the\s+same|as\s+(?:it|they)\s+(?:is|are))|(?:do\s+not|don't)\s+(?:move|change)\s+(?:anything|everything)\s+else)\s*[.!?]*)$/i;
  const match = constraint.exec(text);
  if (!match && /^only\s+(?:move|put|shift|relocate|place|resize|make|swap|switch)\b/i.test(text))
    return { request: text.replace(/^only\s+/i, ""), keepOthers: true };
  return match
    ? { request: text.slice(0, match.index).trim(), keepOthers: true }
    : { request: text, keepOthers: false };
}

function changedOtherRooms(before: Built, after: Built, allowed: Set<string>): string[] {
  const next = new Map(after.plan.rooms.map((room) => [room.id, room]));
  return before.plan.rooms
    .filter((room) => !allowed.has(room.id))
    .filter((room) => {
      const now = next.get(room.id);
      return !now || JSON.stringify(now.rect) !== JSON.stringify(room.rect);
    })
    .map((room) => room.name);
}

/**
 * The design as a measured evaluation, worked out from the model alone: the rows of rooms are read
 * back from its geometry and the locks from its spaces, so nothing the solver stored is needed.
 */
export function evaluationOf(built: Built): Evaluation {
  const r = evaluationOfModel({ program: built.program, model: built.model, seed: built.seed });
  if (!r.ok) throw new Error(r.reason);
  return r.evaluation;
}

async function askModel(
  fetcher: Fetch,
  text: string,
  ev: Evaluation,
): Promise<{ edit?: Edit; error?: string }> {
  const round1 = (n: number) => Math.round(n * 10) / 10;
  let res: Response;
  try {
    res = await fetcher("/api/design/edit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        program: ev.program,
        rooms: ev.plan.rooms.map((r) => {
          const [x, y] = centre(r.rect);
          return { id: r.id, name: r.name, x: round1(x), y: round1(y) };
        }),
        shell: { w: ev.plan.shell.w, h: ev.plan.shell.h },
      }),
    });
  } catch {
    return { error: "the model service is not reachable" };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    return { error: typeof data.error === "string" ? data.error : "the model service failed" };
  const parsed = EditSchema.safeParse(data.edit);
  return parsed.success ? { edit: parsed.data } : { error: "the model's answer was not usable" };
}

/**
 * Change a design with a typed sentence. A small fixed grammar reads the common requests with no
 * model; anything else goes to the model, which can only answer in the same closed operations.
 * Either way the operations are applied by `applyEdit`, which measures the result and refuses
 * what would break the plan, so a wrong guess can never produce an invalid office.
 */
export async function editByWords(
  text: string,
  built: Built,
  options: { fetcher?: Fetch; useModel?: boolean } = {},
): Promise<EditResult> {
  const { request, keepOthers } = separateKeepRequest(text);
  if (keepOthers && !request)
    return {
      entry: {
        text,
        by: "rules",
        lines: [{ status: "refused", text: "Tell me which room to change." }],
      },
    };
  const fetcher = options.fetcher ?? fetch.bind(globalThis);
  const state = { program: built.program, model: built.model, seed: built.seed };
  const measured = evaluationOfModel(state);
  const entry: EditEntry = { text, by: "rules", lines: [] };
  if (!measured.ok) {
    entry.lines.push({ status: "refused", text: measured.reason });
    return { entry };
  }
  const ev = measured.evaluation;
  const said = understandEdit(request, {
    phoneBooths: ev.program.phoneBooths,
    meetingRooms: ev.plan.rooms.filter((r) => r.kind === "meeting_room").length,
    names: ev.plan.rooms.map((r) => r.name),
  });
  if (said.kind === "undo") return { entry, undo: true };

  let ops = said.kind === "edit" ? said.ops : [];
  if (said.kind === "edit")
    for (const note of said.notes) entry.lines.push({ status: "note", text: note });
  if (said.kind === "unknown") {
    if (options.useModel === false) {
      entry.lines.push({ status: "refused", text: `I did not understand that. ${HELP}` });
      return { entry };
    }
    const asked = await askModel(fetcher, request, ev);
    if (!asked.edit) {
      entry.lines.push({
        status: "refused",
        text: `I did not understand that, and the model could not help (${asked.error}). ${HELP}`,
      });
      return { entry };
    }
    entry.by = "model";
    ops = asked.edit.ops;
    if (ops.length === 0)
      entry.lines.push({
        status: "refused",
        text: asked.edit.unsupported
          ? `${asked.edit.unsupported} ${HELP}`
          : `That is not something I can change yet. ${HELP}`,
      });
  }
  if (ops.length === 0) return { entry };

  // The constraint is meaningful only when we know which existing rooms may change.
  const allowed = new Set<string>();
  if (keepOthers) {
    const roomByName = (name: string) =>
      ev.plan.rooms.find(
        (room) =>
          room.id.toLowerCase() === name.toLowerCase() ||
          room.name.toLowerCase() === name.toLowerCase().replace(/^(?:the|my|our)\s+/, ""),
      );
    for (const op of ops) {
      if (op.op === "move_room" || op.op === "resize_room") {
        const room = roomByName(op.room);
        if (room) allowed.add(room.id);
      } else if (op.op === "swap_rooms") {
        for (const name of [op.a, op.b]) {
          const room = roomByName(name);
          if (room) allowed.add(room.id);
        }
      } else if (op.op === "add_room" || op.op === "remove_room") {
        entry.lines = [
          {
            status: "refused",
            text: "Adding or removing a room would change the others. I left this design alone.",
          },
        ];
        return { entry };
      }
    }
  }

  const edit = editModel(state, ops, { base: ev });
  if (!edit.ok) {
    entry.lines.push({ status: "refused", text: edit.reason });
    return { entry };
  }
  if (keepOthers && edit.outcome.changed) {
    const changed = changedOtherRooms(built, { ...built, plan: edit.evaluation.plan }, allowed);
    if (changed.length) {
      entry.lines = [
        {
          status: "refused",
          text: `That would also move ${changed.slice(0, 3).join(", ")}. I left the design alone.`,
        },
      ];
      return { entry };
    }
  }
  for (const step of edit.outcome.steps)
    entry.lines.push({
      status: step.status,
      text: step.message.replace(/\s*Score -?\d+(?:\.\d+)? → -?\d+(?:\.\d+)?\./g, ""),
    });
  if (!edit.outcome.changed) return { entry };
  return { entry, built: builtFromEvaluation(edit.evaluation, built, entry, edit.state.model) };
}
