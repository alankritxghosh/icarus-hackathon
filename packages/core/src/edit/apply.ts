import { centre, type Side } from "../geometry";
import { layoutOffice } from "../layout";
import type { FloorPlan } from "../layout/types";
import type { Program } from "../program";
import type { Issue } from "../repair/diagnose";
import { type Evaluation, evaluateProgram } from "../repair/evaluate";
import type { EditOp } from "./ops";
import { resolveRoom } from "./rooms";

export interface EditStep {
  op: EditOp;
  /** `unchanged` means the plan already satisfies the request; `refused` means it could not be done safely. */
  status: "applied" | "unchanged" | "refused";
  /** What happened, with the measured numbers, in plain words. */
  message: string;
}

export interface EditOutcome {
  /** The plan after the edit; the very same evaluation that went in when nothing changed. */
  evaluation: Evaluation;
  steps: EditStep[];
  changed: boolean;
}

/** A locked room may drift this far when its neighbours change: the larger of 2 m and 12% of the longest wall. */
export const lockTolerance = (shell: { w: number; h: number }) =>
  Math.max(2, 0.12 * Math.max(shell.w, shell.h));

/** A room is "in the east" when its centre is in the eastern 40% of the shell, and likewise for the other sides. */
const ZONE_FRACTION = 0.4;
export function inZone(point: [number, number], shell: { w: number; h: number }, side: Side) {
  switch (side) {
    case "east":
      return point[0] >= shell.w * (1 - ZONE_FRACTION);
    case "west":
      return point[0] <= shell.w * ZONE_FRACTION;
    case "north":
      return point[1] <= shell.h * ZONE_FRACTION;
    case "south":
      return point[1] >= shell.h * (1 - ZONE_FRACTION);
  }
}

const dist = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const round1 = (n: number) => Math.round(n * 10) / 10;
const MAX_BOOTHS = 12;
/** Candidate arrangements fully measured per request, best by solver cost first. */
const MEASURED_CANDIDATES = 12;

const roomCentre = (plan: FloorPlan, id: string): [number, number] | undefined => {
  const room = plan.rooms.find((r) => r.id === id);
  return room ? centre(room.rect) : undefined;
};
const nameOf = (plan: FloorPlan, id: string) => plan.rooms.find((r) => r.id === id)?.name ?? id;

/** "A, B and 3 more" so a long list stays readable. */
const listNames = (names: string[]) =>
  names.length <= 3
    ? names.join(names.length === 3 ? ", " : " and ").replace(/, ([^,]*)$/, " and $1")
    : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;

const issueKey = (i: Issue) => `${i.code}:${[...i.roomIds].sort().join(",")}`;

/** Problems an edit introduced: new failures, and reception losing the front door. Existing ones do not count against it. */
function introduced(before: Issue[], after: Issue[]): Issue[] {
  const had = new Set(before.map(issueKey));
  return after.filter(
    (i) =>
      !had.has(issueKey(i)) &&
      (i.severity === "fail" || (i.code === "reception_off_entrance" && i.severity !== "info")),
  );
}

/** Rooms other than the ones moved on purpose whose centres shifted noticeably, largest first. */
function shifted(before: FloorPlan, after: FloorPlan, except: string[]) {
  const out: { name: string; metres: number }[] = [];
  for (const room of after.rooms) {
    if (except.includes(room.id)) continue;
    const was = roomCentre(before, room.id);
    if (!was) continue;
    const metres = dist(was, centre(room.rect));
    if (metres >= 1.5) out.push({ name: room.name, metres: round1(metres) });
  }
  return out.sort((a, b) => b.metres - a.metres);
}

const sentenceOfShifts = (list: { name: string; metres: number }[]) =>
  list.length
    ? ` Also shifted: ${list
        .slice(0, 3)
        .map((s) => `${s.name} (${s.metres} m)`)
        .join(", ")}${list.length > 3 ? ` and ${list.length - 3} more` : ""}.`
    : "";

/** Said plainly when an edit the user asked for makes the measured plan worse, so they can undo it knowingly. */
function worseNote(before: number, after: number): string {
  return after > before + 3
    ? " This measures noticeably worse than before; Undo puts it back."
    : "";
}

function freshNotes(before: Issue[], after: Issue[]): string {
  const had = new Set(before.map(issueKey));
  const fresh = after.filter((i) => i.severity !== "info" && !had.has(issueKey(i)));
  if (fresh.length === 0) return "";
  return ` New notes: ${fresh
    .slice(0, 2)
    .map((i) => i.message)
    .join(" ")}`;
}

/** Hold the current arrangement in the program so every later step re-plans exactly this plan. */
const pin = (ev: Evaluation): Evaluation => ({
  ...ev,
  program: { ...ev.program, arrangement: ev.plan.search.rows.map((row) => [...row]) },
});

interface Settled {
  evaluation?: Evaluation;
  reason?: string;
}

/**
 * Choose among candidate arrangements the best one that does what was asked, keeps every locked
 * room within tolerance and introduces no new failure. Every candidate is planned and the best few
 * are fully measured; nothing is kept on the strength of the request alone.
 */
function settle(
  cur: Evaluation,
  candidates: string[][][],
  intent: (plan: FloorPlan) => boolean,
  subject: string[],
): Settled {
  const tolerance = lockTolerance(cur.plan.shell);
  const locked = cur.program.locks.filter((l) => cur.plan.rooms.some((r) => r.id === l.id));
  const seen = new Set<string>();
  const viable: { rows: string[][]; plan: FloorPlan; moved: number }[] = [];
  const blockers = new Set<string>();
  let meant = 0;
  for (const rows of candidates) {
    const key = JSON.stringify(rows);
    if (seen.has(key)) continue;
    seen.add(key);
    const plan = layoutOffice({ ...cur.program, arrangement: rows }, { seed: cur.seed });
    if (!intent(plan)) continue;
    meant++;
    const drifted = locked.filter((l) => {
      const at = roomCentre(plan, l.id);
      return at !== undefined && dist(at, [l.x, l.y]) > tolerance;
    });
    if (drifted.length) {
      for (const l of drifted) blockers.add(nameOf(plan, l.id));
      continue;
    }
    viable.push({
      rows,
      plan,
      moved: shifted(cur.plan, plan, subject).reduce((s, r) => s + r.metres, 0),
    });
  }
  if (meant === 0)
    return { reason: "No arrangement of the existing rows does this, so the plan was left alone." };
  if (viable.length === 0)
    return {
      reason: `Doing this would move ${listNames([...blockers])}, which you locked in place (a locked room may drift ${round1(tolerance)} m). Unlock ${blockers.size > 1 ? "them" : "it"} first, or ask for something else.`,
    };
  viable.sort(
    (a, b) =>
      Math.round(a.plan.search.cost * 100) - Math.round(b.plan.search.cost * 100) ||
      a.moved - b.moved,
  );
  // Rank by the solver's own cost, then measure the best few fully and keep the one that scores best
  // on the same issues the user sees. An arrangement that breaks something is never chosen.
  let because: Issue | undefined;
  let best: Evaluation | undefined;
  for (const v of viable.slice(0, MEASURED_CANDIDATES)) {
    const ev = evaluateProgram({ ...cur.program, arrangement: v.rows }, { seeds: [cur.seed] });
    const fresh = introduced(cur.issues, ev.issues);
    if (fresh.length > 0) {
      because ??= fresh[0];
      continue;
    }
    if (!best || ev.cost < best.cost - 0.01) best = ev;
  }
  if (best) return { evaluation: best };
  const hint =
    because?.code === "reception_off_entrance"
      ? " Reception has to stay on the entrance lobby, so ask for the other room to move instead."
      : "";
  return {
    reason: `Every arrangement that does this breaks something: ${because?.message ?? "a check failed."}${hint} The plan was left alone.`,
  };
}

function moveCandidates(rows: string[][], id: string): string[][][] {
  const base = rows.map((row) => row.filter((x) => x !== id));
  const out: string[][][] = [];
  base.forEach((row, r) => {
    for (let i = 0; i <= row.length; i++) {
      const next = base.map((x) => [...x]);
      next[r]?.splice(i, 0, id);
      if (next.every((x) => x.length > 0)) out.push(next);
    }
  });
  for (const other of rows.flat()) {
    if (other === id) continue;
    out.push(swapIds(rows, id, other));
  }
  return out;
}

function swapIds(rows: string[][], a: string, b: string): string[][] {
  return rows.map((row) => row.map((x) => (x === a ? b : x === b ? a : x)));
}

/** Keep reception first in its row, where it touches the entrance lobby. */
function receptionFirst(rows: string[][]): string[][] {
  return rows.map((row) => {
    const at = row.findIndex((id) => id.startsWith("reception."));
    if (at <= 0) return row;
    return [row[at] as string, ...row.filter((_, i) => i !== at)];
  });
}

const withBooths = (program: Program, total: number): Program => ({
  ...program,
  phoneBooths: total,
  assumptions: [
    ...program.assumptions.filter((a) => a.topic !== "phone booths"),
    {
      topic: "phone booths",
      statement: `${total} phone booth${total === 1 ? "" : "s"}, as you asked.`,
      source: "brief",
      confidence: 1,
    },
  ],
});

function step(op: EditOp, status: EditStep["status"], message: string): EditStep {
  return { op, status, message };
}

/**
 * Apply edit operations to a measured design. Each operation works on the arrangement of rooms
 * (the order within each row), so an edit changes what was asked and little else, and is kept only
 * if it does what it says, respects locks and the user's facts, and breaks nothing that worked.
 * Operations apply in order; a refused one leaves the plan as it was and the rest still run.
 */
export function applyEdit(current: Evaluation, ops: EditOp[]): EditOutcome {
  let cur = pin(current);
  const steps: EditStep[] = [];

  for (const op of ops) {
    const plan = cur.plan;
    const shell = { w: plan.shell.w, h: plan.shell.h };
    const rows = plan.search.rows;

    if (op.op === "move_room") {
      const found = resolveRoom(plan, op.room);
      if (!found.ok) {
        steps.push(step(op, "refused", found.reason));
        continue;
      }
      const name = nameOf(plan, found.id);
      const at = roomCentre(plan, found.id) as [number, number];
      const along = op.to === "east" || op.to === "west" ? 0 : 1;
      const fromWall = (p: [number, number]) =>
        round1(op.to === "east" || op.to === "west" ? p[0] : p[1]);
      const wall = op.to === "east" || op.to === "west" ? "west" : "north";
      if (cur.program.locks.some((l) => l.id === found.id)) {
        steps.push(step(op, "refused", `${name} is locked in place. Unlock it to move it.`));
        continue;
      }
      if (inZone(at, shell, op.to)) {
        steps.push(
          step(
            op,
            "unchanged",
            `${name} is already in the ${op.to} part of the office (its centre is ${fromWall(at)} m from the ${wall} wall of ${round1(shell[along === 0 ? "w" : "h"])} m).`,
          ),
        );
        continue;
      }
      const result = settle(
        cur,
        moveCandidates(rows, found.id),
        (p) => {
          const c = roomCentre(p, found.id);
          return c !== undefined && inZone(c, { w: p.shell.w, h: p.shell.h }, op.to);
        },
        [found.id],
      );
      if (!result.evaluation) {
        steps.push(step(op, "refused", result.reason ?? "This could not be done."));
        continue;
      }
      const now = roomCentre(result.evaluation.plan, found.id) as [number, number];
      steps.push(
        step(
          op,
          "applied",
          `Moved ${name} to the ${op.to}: its centre is now ${fromWall(now)} m from the ${wall} wall (was ${fromWall(at)} m).${sentenceOfShifts(shifted(plan, result.evaluation.plan, [found.id]))}${freshNotes(cur.issues, result.evaluation.issues)} Score ${cur.cost.toFixed(1)} → ${result.evaluation.cost.toFixed(1)}.${worseNote(cur.cost, result.evaluation.cost)}`,
        ),
      );
      cur = result.evaluation;
    } else if (op.op === "swap_rooms") {
      const a = resolveRoom(plan, op.a);
      const b = resolveRoom(plan, op.b);
      if (!a.ok || !b.ok) {
        steps.push(step(op, "refused", !a.ok ? a.reason : (b as { reason: string }).reason));
        continue;
      }
      if (a.id === b.id) {
        steps.push(step(op, "refused", "That names the same room twice."));
        continue;
      }
      const locked = [a.id, b.id].filter((id) => cur.program.locks.some((l) => l.id === id));
      if (locked.length) {
        steps.push(
          step(
            op,
            "refused",
            `${locked.map((id) => nameOf(plan, id)).join(" and ")} ${locked.length > 1 ? "are" : "is"} locked in place. Unlock to swap.`,
          ),
        );
        continue;
      }
      const swapped = swapIds(rows, a.id, b.id);
      const where = (list: string[][], id: string) => {
        const row = list.findIndex((r) => r.includes(id));
        return { row, at: list[row]?.indexOf(id) ?? -1 };
      };
      const wasA = where(rows, a.id);
      const wasB = where(rows, b.id);
      // Done when each room holds the other's row, or, in one row, when their order has flipped.
      const exchanged = (p: FloorPlan) => {
        const nowA = where(p.search.rows, a.id);
        const nowB = where(p.search.rows, b.id);
        return wasA.row === wasB.row
          ? nowA.row === wasA.row &&
              nowB.row === wasB.row &&
              nowA.at > nowB.at === wasA.at < wasB.at
          : nowA.row === wasB.row && nowB.row === wasA.row;
      };
      const result = settle(cur, [swapped, receptionFirst(swapped)], exchanged, [a.id, b.id]);
      if (!result.evaluation) {
        steps.push(step(op, "refused", result.reason ?? "This could not be done."));
        continue;
      }
      const kept = JSON.stringify(result.evaluation.plan.search.rows) !== JSON.stringify(swapped);
      steps.push(
        step(
          op,
          "applied",
          `Swapped ${nameOf(plan, a.id)} and ${nameOf(plan, b.id)}.${kept ? " Reception was kept first in its row so it stays on the entrance lobby." : ""}${sentenceOfShifts(shifted(plan, result.evaluation.plan, [a.id, b.id]))}${freshNotes(cur.issues, result.evaluation.issues)} Score ${cur.cost.toFixed(1)} → ${result.evaluation.cost.toFixed(1)}.${worseNote(cur.cost, result.evaluation.cost)}`,
        ),
      );
      cur = result.evaluation;
    } else if (op.op === "add_phone_booths" || op.op === "remove_phone_booths") {
      const have = cur.program.phoneBooths;
      const adding = op.op === "add_phone_booths";
      const total = adding ? have + op.count : Math.max(0, have - op.count);
      if (total === have) {
        steps.push(step(op, "unchanged", "There are no phone booths to remove."));
        continue;
      }
      if (total > MAX_BOOTHS) {
        steps.push(step(op, "refused", `An office plan holds at most ${MAX_BOOTHS} phone booths.`));
        continue;
      }
      const next = evaluateProgram(withBooths(cur.program, total), { seeds: [cur.seed] });
      const placedBefore = cur.furnished.report.phoneBoothsPlaced;
      const placedAfter = next.furnished.report.phoneBoothsPlaced;
      if (adding && placedAfter < placedBefore + (total - have)) {
        steps.push(
          step(
            op,
            "refused",
            `Only ${Math.max(0, placedAfter - placedBefore)} more phone booth${placedAfter - placedBefore === 1 ? "" : "s"} fit along the open workspace walls, so none were added.`,
          ),
        );
        continue;
      }
      const broken = introduced(cur.issues, next.issues)[0];
      if (broken) {
        steps.push(
          step(
            op,
            "refused",
            `${adding ? "Adding" : "Removing"} ${op.count} phone booth${op.count === 1 ? "" : "s"} would break the plan: ${broken.message} The plan was left alone.`,
          ),
        );
        continue;
      }
      steps.push(
        step(
          op,
          "applied",
          adding
            ? `Added ${total - have} phone booth${total - have === 1 ? "" : "s"}: ${placedAfter} placed along the workspace walls.${freshNotes(cur.issues, next.issues)}`
            : `Removed ${have - total} phone booth${have - total === 1 ? "" : "s"}: ${total} left.`,
        ),
      );
      cur = next;
    } else if (op.op === "lock_room") {
      const found = resolveRoom(plan, op.room);
      if (!found.ok) {
        steps.push(step(op, "refused", found.reason));
        continue;
      }
      const name = nameOf(plan, found.id);
      if (cur.program.locks.some((l) => l.id === found.id)) {
        steps.push(step(op, "unchanged", `${name} is already locked.`));
        continue;
      }
      const at = roomCentre(plan, found.id) as [number, number];
      cur = {
        ...cur,
        program: {
          ...cur.program,
          locks: [...cur.program.locks, { id: found.id, x: round1(at[0]), y: round1(at[1]) }],
        },
      };
      steps.push(
        step(
          op,
          "applied",
          `Locked ${name}: later changes will keep it where it is (within ${round1(lockTolerance(shell))} m).`,
        ),
      );
    } else {
      const everything = op.room.trim().toLowerCase() === "all";
      if (everything) {
        const n = cur.program.locks.length;
        steps.push(
          n
            ? step(op, "applied", `Unlocked ${n} room${n === 1 ? "" : "s"}.`)
            : step(op, "unchanged", "Nothing was locked."),
        );
        if (n) cur = { ...cur, program: { ...cur.program, locks: [] } };
        continue;
      }
      const found = resolveRoom(plan, op.room);
      if (!found.ok) {
        steps.push(step(op, "refused", found.reason));
        continue;
      }
      const name = nameOf(plan, found.id);
      if (!cur.program.locks.some((l) => l.id === found.id)) {
        steps.push(step(op, "unchanged", `${name} was not locked.`));
        continue;
      }
      cur = {
        ...cur,
        program: {
          ...cur.program,
          locks: cur.program.locks.filter((l) => l.id !== found.id),
        },
      };
      steps.push(step(op, "applied", `Unlocked ${name}.`));
    }
  }

  const changed = steps.some((s) => s.status === "applied");
  return { evaluation: changed ? cur : current, steps, changed };
}

/** Score of an evaluation for display; the same number the repair loop compares. */
export const scoreOf = (ev: Evaluation) => Math.round(ev.cost * 10) / 10;
