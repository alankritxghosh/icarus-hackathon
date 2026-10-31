import { KIND_RULES } from "../catalog";
import { centre, type Side } from "../geometry";
import { layoutOffice } from "../layout";
import type { FloorPlan } from "../layout/types";
import { expandRooms, type Program } from "../program";
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
  // A warning that has become a failure counts as new, so failures are matched among failures only.
  const hadFail = new Set(before.filter((i) => i.severity === "fail").map(issueKey));
  return after.filter(
    (i) =>
      (i.severity === "fail" && !hadFail.has(issueKey(i))) ||
      (i.code === "reception_off_entrance" && i.severity !== "info" && !had.has(issueKey(i))),
  );
}

/** Material changes to other rooms, including resizing without a large centre shift. */
function shifted(before: FloorPlan, after: FloorPlan, except: string[]) {
  const out: { name: string; metres: number; resized: boolean }[] = [];
  for (const room of after.rooms) {
    if (except.includes(room.id)) continue;
    const old = before.rooms.find((r) => r.id === room.id);
    if (!old) continue;
    const metres = dist(centre(old.rect), centre(room.rect));
    const resized =
      Math.max(Math.abs(room.rect.w - old.rect.w), Math.abs(room.rect.h - old.rect.h)) >= 0.25;
    if (metres >= 0.25 || resized) out.push({ name: room.name, metres: round1(metres), resized });
  }
  return out.sort((a, b) => b.metres - a.metres || a.name.localeCompare(b.name));
}

const sentenceOfShifts = (list: { name: string; metres: number; resized: boolean }[]) =>
  list.length
    ? ` Also changed: ${list
        .map(
          (s) =>
            `${s.name} (${[s.metres >= 0.25 ? `moved ${s.metres} m` : "", s.resized ? "resized" : ""].filter(Boolean).join(", ")})`,
        )
        .join("; ")}.`
    : "";

// Preserve the original candidate ranking while making user-facing disclosure more complete.
const rankingMovement = (before: FloorPlan, after: FloorPlan, except: string[]) =>
  after.rooms.reduce((sum, room) => {
    if (except.includes(room.id)) return sum;
    const was = roomCentre(before, room.id);
    if (!was) return sum;
    const metres = dist(was, centre(room.rect));
    return metres >= 1.5 ? sum + round1(metres) : sum;
  }, 0);

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

/** Why a resize changed nothing, from the measurements, so the user is not told something vague. */
function pinnedReason(room: FloorPlan["rooms"][number], area: number, bigger: boolean): string {
  const rule = KIND_RULES[room.kind];
  if (bigger && area >= room.targetAreaM2 * 1.02)
    return `${room.name} is already ${round1(area)} m², above its ${round1(room.targetAreaM2)} m² target, because a ${rule.label.toLowerCase()} cannot be narrower than ${rule.minWidth} m; a larger target changes nothing, so it was left alone.`;
  if (!bigger && (room.rect.w <= rule.minWidth + 0.05 || room.rect.h <= rule.minDepth + 0.05))
    return `${room.name} is already at the smallest a ${rule.label.toLowerCase()} works at (${rule.minWidth} m wide, ${rule.minDepth} m deep), so it was left alone.`;
  return `${room.name} cannot get ${bigger ? "bigger" : "smaller"} here without breaking something, so it was left alone.`;
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
  none = "No arrangement of the existing rows does this, so the plan was left alone.",
): Settled {
  const tolerance = lockTolerance(cur.plan.shell);
  const locked = cur.program.locks;
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
      moved: rankingMovement(cur.plan, plan, subject),
    });
  }
  if (meant === 0) return { reason: none };
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

type Request = Program["rooms"][number];
const MAX_MEETING_ROOMS = 12;
const MAX_REQUESTS = 40;

/** Which request holds a room, and where in it, using the same numbering as `expandRooms`. */
function locate(program: Program, id: string): { r: number; i: number } | undefined {
  const seen = new Map<string, number>();
  for (let r = 0; r < program.rooms.length; r++) {
    const req = program.rooms[r] as Request;
    for (let i = 0; i < req.count; i++) {
      const n = (seen.get(req.kind) ?? 0) + 1;
      seen.set(req.kind, n);
      if (`${req.kind}.${n}` === id) return { r, i };
    }
  }
  return undefined;
}

/** Give one room its own floor area. Splits its request so every other room keeps its id and size. */
function withRoomArea(program: Program, id: string, areaM2: number): Program | undefined {
  const at = locate(program, id);
  const req = at && (program.rooms[at.r] as Request);
  if (!at || !req || (req.count > 1 && req.name)) return undefined;
  const pieces: Request[] = [
    ...(at.i > 0 ? [{ ...req, count: at.i }] : []),
    { ...req, count: 1, areaM2 },
    ...(at.i < req.count - 1 ? [{ ...req, count: req.count - at.i - 1 }] : []),
  ];
  return {
    ...program,
    rooms: [...program.rooms.slice(0, at.r), ...pieces, ...program.rooms.slice(at.r + 1)],
  };
}

const idParts = (id: string) => {
  const dot = id.lastIndexOf(".");
  return { kind: id.slice(0, dot), n: Number(id.slice(dot + 1)) };
};

/** The program without one room, and how every room id changes because later ones are renumbered. */
function withoutRoom(
  program: Program,
  id: string,
): { program: Program; remap: (id: string) => string | undefined } | undefined {
  const at = locate(program, id);
  const req = at && (program.rooms[at.r] as Request);
  if (!at || !req) return undefined;
  const gone = idParts(id);
  const remap = (other: string) => {
    if (other === id) return undefined;
    const p = idParts(other);
    return p.kind === gone.kind && p.n > gone.n ? `${p.kind}.${p.n - 1}` : other;
  };
  const rooms =
    req.count > 1
      ? program.rooms.map((x, r) => (r === at.r ? { ...x, count: x.count - 1 } : x))
      : program.rooms.filter((_, r) => r !== at.r);
  const rows = (program.arrangement ?? [])
    .map((row) => row.map(remap).filter((x): x is string => x !== undefined))
    .filter((row) => row.length > 0);
  return {
    remap,
    program: {
      ...program,
      rooms,
      arrangement: rows.length ? rows : undefined,
      locks: program.locks.flatMap((l) => {
        const next = remap(l.id);
        return next ? [{ ...l, id: next }] : [];
      }),
    },
  };
}

const meetingCount = (program: Program) =>
  program.rooms.filter((r) => r.kind === "meeting_room").reduce((s, r) => s + r.count, 0);

const withMeetingNote = (program: Program): Program => ({
  ...program,
  assumptions: [
    ...program.assumptions.filter((a) => a.topic !== "meeting rooms"),
    {
      topic: "meeting rooms",
      statement: `${meetingCount(program)} meeting room${meetingCount(program) === 1 ? "" : "s"}, as you asked.`,
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
    } else if (op.op === "resize_room") {
      const found = resolveRoom(plan, op.room);
      if (!found.ok) {
        steps.push(step(op, "refused", found.reason));
        continue;
      }
      const room = plan.rooms.find((r) => r.id === found.id) as FloorPlan["rooms"][number];
      if (cur.program.locks.some((l) => l.id === found.id)) {
        steps.push(step(op, "refused", `${room.name} is locked in place. Unlock it to resize it.`));
        continue;
      }
      const was = room.rect.w * room.rect.h;
      const area = Math.min(500, Math.max(2, round1(room.targetAreaM2 * op.factor)));
      const resized = withRoomArea(cur.program, found.id, area);
      if (!resized) {
        steps.push(step(op, "refused", `${room.name} could not be resized on its own.`));
        continue;
      }
      const bigger = op.factor > 1;
      const result = settle(
        { ...cur, program: resized },
        [rows],
        (p) => {
          const r = p.rooms.find((x) => x.id === found.id)?.rect;
          const now = r ? r.w * r.h : was;
          return bigger ? now >= was * 1.05 : now <= was * 0.95;
        },
        [found.id],
        pinnedReason(room, was, bigger),
      );
      if (!result.evaluation) {
        steps.push(step(op, "refused", result.reason ?? "This could not be done."));
        continue;
      }
      const now = result.evaluation.plan.rooms.find((r) => r.id === found.id)?.rect;
      steps.push(
        step(
          op,
          "applied",
          `Made ${room.name} ${bigger ? "bigger" : "smaller"}: ${round1(was)} m² → ${round1(now ? now.w * now.h : was)} m² (target ${round1(room.targetAreaM2)} → ${area} m²).${sentenceOfShifts(shifted(plan, result.evaluation.plan, [found.id]))}${freshNotes(cur.issues, result.evaluation.issues)} Score ${cur.cost.toFixed(1)} → ${result.evaluation.cost.toFixed(1)}.${worseNote(cur.cost, result.evaluation.cost)}`,
        ),
      );
      cur = result.evaluation;
    } else if (op.op === "add_room") {
      const before = cur;
      let working = cur;
      let failed: string | undefined;
      const added: string[] = [];
      for (let n = 0; n < op.count && !failed; n++) {
        if (
          working.program.rooms.length >= MAX_REQUESTS ||
          meetingCount(working.program) >= MAX_MEETING_ROOMS
        ) {
          failed = `An office plan holds at most ${MAX_MEETING_ROOMS} meeting rooms.`;
          break;
        }
        const program = withMeetingNote({
          ...working.program,
          rooms: [
            ...working.program.rooms,
            { kind: "meeting_room", count: 1, ...(op.capacity ? { capacity: op.capacity } : {}) },
          ],
        });
        const newId = expandRooms(program)
          .filter((r) => r.kind === "meeting_room")
          .map((r) => r.id)
          .pop() as string;
        const base = working.plan.search.rows;
        const candidates = base.flatMap((row, r) =>
          Array.from({ length: row.length + 1 }, (_, i) =>
            base.map((x, k) => (k === r ? [...x.slice(0, i), newId, ...x.slice(i)] : [...x])),
          ),
        );
        const result = settle({ ...working, program }, candidates, () => true, [newId]);
        if (!result.evaluation) {
          failed = result.reason ?? "This could not be done.";
          break;
        }
        added.push(newId);
        working = result.evaluation;
      }
      if (failed || added.length === 0) {
        steps.push(
          step(
            op,
            "refused",
            `${failed ?? "This could not be done."}${added.length ? " None were added." : ""}`,
          ),
        );
        continue;
      }
      const names = added.map((id) => nameOf(working.plan, id));
      const last = working.plan.rooms.find((r) => r.id === added[added.length - 1]);
      steps.push(
        step(
          op,
          "applied",
          `Added ${names.join(" and ")}${op.capacity ? ` (${op.capacity} seats)` : ""}${last ? `, ${round1(last.rect.w * last.rect.h)} m², centred ${round1(last.rect.x + last.rect.w / 2)} m from the west wall and ${round1(last.rect.y + last.rect.h / 2)} m from the north wall` : ""}.${sentenceOfShifts(shifted(before.plan, working.plan, added))}${freshNotes(before.issues, working.issues)} Score ${before.cost.toFixed(1)} → ${working.cost.toFixed(1)}.${worseNote(before.cost, working.cost)}`,
        ),
      );
      cur = working;
    } else if (op.op === "remove_room") {
      const found = resolveRoom(plan, op.room);
      if (!found.ok) {
        steps.push(step(op, "refused", found.reason));
        continue;
      }
      const name = nameOf(plan, found.id);
      if (!found.id.startsWith("meeting_room.")) {
        steps.push(
          step(op, "refused", `Only meeting rooms can be added or removed here; ${name} stays.`),
        );
        continue;
      }
      if (cur.program.locks.some((l) => l.id === found.id)) {
        steps.push(step(op, "refused", `${name} is locked in place. Unlock it to remove it.`));
        continue;
      }
      const gone = withoutRoom(cur.program, found.id);
      if (!gone) {
        steps.push(step(op, "refused", `${name} could not be removed.`));
        continue;
      }
      const trial: Evaluation = {
        ...cur,
        program: withMeetingNote(gone.program),
        issues: cur.issues.map((i) => ({
          ...i,
          roomIds: i.roomIds.flatMap((id) => gone.remap(id) ?? []),
        })),
      };
      const result = settle(trial, [gone.program.arrangement ?? []], () => true, [], undefined);
      if (!result.evaluation) {
        steps.push(step(op, "refused", result.reason ?? "This could not be done."));
        continue;
      }
      steps.push(
        step(
          op,
          "applied",
          `Removed ${name}; remaining meeting rooms were re-laid out and renumbered: ${result.evaluation.plan.rooms
            .filter((r) => r.kind === "meeting_room")
            .map((r) => r.name)
            .join(", ")}.${sentenceOfShifts(
            shifted(
              plan,
              result.evaluation.plan,
              plan.rooms.filter((r) => r.kind === "meeting_room").map((r) => r.id),
            ),
          )}${freshNotes(trial.issues, result.evaluation.issues)} Score ${cur.cost.toFixed(1)} → ${result.evaluation.cost.toFixed(1)}.`,
        ),
      );
      cur = result.evaluation;
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
