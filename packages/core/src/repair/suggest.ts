import { KIND_RULES, type RoomKind } from "../catalog";
import { expandRooms, type Program } from "../program";
import type { Issue } from "./diagnose";
import { type Evaluation, evaluateProgram } from "./evaluate";
import { shellIsStated } from "./patch";

/** A change to the user's own facts that would fix a failure the loop cannot fix alone. Offered, never applied silently. */
export interface Suggestion {
  id: string;
  label: string;
  detail: string;
  /** What re-planning with this change measured, so the offer is a result and not a guess. */
  verified: { open: number; fail: number };
  change:
    | { kind: "grow_shell"; widthM: number; depthM: number }
    | { kind: "drop_room"; roomKind: RoomKind; count: number };
}

const DROPPABLE: RoomKind[] = [
  "lounge",
  "storage",
  "server_room",
  "private_office",
  "meeting_room",
];
const half = (m: number) => Math.ceil(m / 0.5) * 0.5;
const open = (e: Evaluation) => e.issues.filter((i) => i.severity !== "info");
const fails = (e: Evaluation) => e.issues.filter((i) => i.severity === "fail").length;

/** Apply a suggestion the user accepted. */
export function applySuggestion(program: Program, suggestion: Pick<Suggestion, "change">): Program {
  const change = suggestion.change;
  if (change.kind === "grow_shell")
    return {
      ...program,
      shell: { ...program.shell, widthM: change.widthM, depthM: change.depthM },
    };
  let left = change.count;
  const rooms = program.rooms
    .map((r) => {
      if (r.kind !== change.roomKind || left <= 0) return r;
      const take = Math.min(left, r.count);
      left -= take;
      return { ...r, count: r.count - take };
    })
    .filter((r) => r.count > 0);
  return { ...program, rooms };
}

/** A shell scaled in floor area by `factor`, keeping its proportions, on a half-metre grid. */
export function scaledShell(program: Program, factor: number) {
  const side = Math.sqrt(factor);
  return {
    widthM: Math.min(80, half(program.shell.widthM * side)),
    depthM: Math.min(80, half(program.shell.depthM * side)),
  };
}

/**
 * The smallest enlargement of the shell, by trying them in turn, after which the plan has no
 * failures and almost no warnings. Each candidate is actually planned and measured.
 */
export function fitShell(
  program: Program,
  options: { seeds?: number[]; maxFactor?: number } = {},
): { program: Program; evaluation: Evaluation; widthM: number; depthM: number } | undefined {
  let best:
    | { program: Program; evaluation: Evaluation; widthM: number; depthM: number }
    | undefined;
  for (const factor of [1.1, 1.2, 1.32, 1.45, 1.6, 1.8]) {
    if (factor > (options.maxFactor ?? 1.8)) break;
    const size = scaledShell(program, factor);
    if (size.widthM * size.depthM <= program.shell.widthM * program.shell.depthM) continue;
    const candidate = applySuggestion(program, { change: { kind: "grow_shell", ...size } });
    const evaluation = evaluateProgram(candidate, { seeds: options.seeds ?? [1] });
    const entry = { program: candidate, evaluation, ...size };
    if (!best || evaluation.cost < best.evaluation.cost) best = entry;
    if (fails(evaluation) === 0 && open(evaluation).length <= 1) return entry;
  }
  return best;
}

/**
 * When the program cannot be made to work in the shell, say what would: a larger shell, or fewer
 * optional rooms. Every offer was planned and measured first, and one that does not clearly help
 * is not made.
 */
export function suggestFixes(
  program: Program,
  issues: Issue[],
  current?: Evaluation,
): Suggestion[] {
  const stuck = issues.some((i) => i.code === "program_too_big" || i.code === "crowded");
  if (!stuck) return [];
  const base = current ?? evaluateProgram(program, { seeds: [1, 2] });
  const out: Suggestion[] = [];

  const grown = fitShell(program, { seeds: [1, 2] });
  if (grown && grown.evaluation.cost < base.cost * 0.7)
    out.push({
      id: "grow_shell",
      label: `Enlarge the shell to ${grown.widthM} x ${grown.depthM} m`,
      detail: `Planned and checked: ${open(base).length} open issues become ${open(grown.evaluation).length}.`,
      verified: { open: open(grown.evaluation).length, fail: fails(grown.evaluation) },
      change: { kind: "grow_shell", widthM: grown.widthM, depthM: grown.depthM },
    });

  const planned = expandRooms(program);
  const remaining = new Map<RoomKind, number>();
  for (const r of planned) remaining.set(r.kind, (remaining.get(r.kind) ?? 0) + 1);
  const kinds = [
    ...new Set(planned.filter((r) => DROPPABLE.includes(r.kind)).map((r) => r.kind)),
  ].sort(
    (a, b) =>
      (planned.find((r) => r.kind === b)?.targetAreaM2 ?? 0) -
      (planned.find((r) => r.kind === a)?.targetAreaM2 ?? 0),
  );
  for (const kind of kinds) {
    const have = remaining.get(kind) ?? 0;
    // Never offer to drop the last meeting room or private office the program asked for.
    const count =
      kind === "meeting_room" || kind === "private_office"
        ? Math.min(have - 1, Math.ceil(have / 2))
        : have;
    if (count < 1) continue;
    const change = { kind: "drop_room" as const, roomKind: kind, count };
    const evaluation = evaluateProgram(applySuggestion(program, { change }), { seeds: [1, 2] });
    if (evaluation.cost >= base.cost * 0.6 || fails(evaluation) > fails(base)) continue;
    out.push({
      id: `drop_${kind}`,
      label: `Drop ${count > 1 ? `${count} ` : "the "}${KIND_RULES[kind].label.toLowerCase()}${count > 1 ? "s" : ""}`,
      detail: `Planned and checked: ${open(base).length} open issues become ${open(evaluation).length}.`,
      verified: { open: open(evaluation).length, fail: fails(evaluation) },
      change,
    });
  }
  return out;
}

export { shellIsStated };
