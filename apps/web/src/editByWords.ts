import {
  applyEdit,
  centre,
  type Edit,
  EditSchema,
  type Evaluation,
  evaluateProgram,
  understandEdit,
} from "@icarus/core";
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

/** The design as a measured evaluation, held at its current arrangement so nothing is searched again. */
export function evaluationOf(built: Built): Evaluation {
  return evaluateProgram(
    { ...built.program, arrangement: built.plan.search.rows.map((row) => [...row]) },
    { seeds: [built.seed] },
  );
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
  const ev = evaluationOf(built);
  const said = understandEdit(text, {
    phoneBooths: ev.program.phoneBooths,
    meetingRooms: ev.plan.rooms.filter((r) => r.kind === "meeting_room").length,
    names: ev.plan.rooms.map((r) => r.name),
  });
  const entry: EditEntry = { text, by: "rules", lines: [] };
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

  const outcome = applyEdit(ev, ops);
  for (const step of outcome.steps) entry.lines.push({ status: step.status, text: step.message });
  if (!outcome.changed) return { entry };
  return { entry, built: builtFromEvaluation(outcome.evaluation, built, entry) };
}
