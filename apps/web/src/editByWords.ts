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
  const fetcher = options.fetcher ?? fetch.bind(globalThis);
  const state = { program: built.program, model: built.model, seed: built.seed };
  const measured = evaluationOfModel(state);
  const entry: EditEntry = { text, by: "rules", lines: [] };
  if (!measured.ok) {
    entry.lines.push({ status: "refused", text: measured.reason });
    return { entry };
  }
  const ev = measured.evaluation;
  const said = understandEdit(text, {
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
    const asked = await askModel(fetcher, text, ev);
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

  const edit = editModel(state, ops, { base: ev });
  if (!edit.ok) {
    entry.lines.push({ status: "refused", text: edit.reason });
    return { entry };
  }
  for (const step of edit.outcome.steps)
    entry.lines.push({ status: step.status, text: step.message });
  if (!edit.outcome.changed) return { entry };
  return { entry, built: builtFromEvaluation(edit.evaluation, built, entry, edit.state.model) };
}
