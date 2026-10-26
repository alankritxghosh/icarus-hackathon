import { z } from "zod";
import { KIND_RULES, ROOM_KINDS, type RoomKind } from "../catalog";
import { reachable } from "../evidence";
import type { FurnishReport } from "../furnish";
import { exposureOnSide, facingSpan } from "../geometry";
import { KNOWLEDGE } from "../knowledge";
import { ADJACENT_GAP_M } from "../layout/cost";
import type { FloorPlan } from "../layout/types";
import { expandRooms, type Program } from "../program";

export const IssueSchema = z.object({
  code: z.enum([
    "room_small",
    "room_narrow",
    "room_oversized",
    "adjacency_missed",
    "apart_violated",
    "workspace_density",
    "seats_short",
    "daylight_missing",
    "unreachable",
    "crowded",
    "program_too_big",
    "reception_off_entrance",
  ]),
  /** `info` is reported but never counted against a plan: an oversized room is a donor, not a fault. */
  severity: z.enum(["fail", "warn", "info"]),
  kinds: z.array(z.enum(ROOM_KINDS)).max(12),
  roomIds: z.array(z.string().max(60)).max(40),
  measured: z.number(),
  target: z.number(),
  /** How far short, as a fraction of the target (0 when not applicable). */
  shortfall: z.number(),
  message: z.string().max(300),
});
/** A measured shortfall, with the numbers, in a form both the repairer and a model can act on. */
export type Issue = z.infer<typeof IssueSchema>;
export type IssueCode = Issue["code"];

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Everything that is measurably wrong with a plan, as structured issues. This reads the same
 * geometry and the same knowledge file as the solver and the evidence panel.
 */
export function diagnose(plan: FloorPlan, program: Program, report: FurnishReport): Issue[] {
  const issues: Issue[] = [];
  const shell = { w: plan.shell.w, h: plan.shell.h };

  for (const room of plan.rooms) {
    const rule = KIND_RULES[room.kind];
    const actual = room.rect.w * room.rect.h;
    const scale = actual / room.targetAreaM2;
    if (scale < rule.minScale)
      issues.push({
        code: "room_small",
        severity: "warn",
        kinds: [room.kind],
        roomIds: [room.id],
        measured: round(scale),
        target: rule.minScale,
        shortfall: (rule.minScale - scale) / rule.minScale,
        message: `${room.name} is ${Math.round(scale * 100)}% of its target size; ${Math.round(rule.minScale * 100)}% is the least this kind of room should keep.`,
      });
    else if (scale > KNOWLEDGE.thresholds.oversizeRatio)
      issues.push({
        code: "room_oversized",
        severity: "info",
        kinds: [room.kind],
        roomIds: [room.id],
        measured: round(scale),
        target: KNOWLEDGE.thresholds.oversizeRatio,
        shortfall: 0,
        message: `${room.name} is ${Math.round(scale * 100)}% of its target size, so it may be taking space other rooms need.`,
      });
    const narrow = Math.min(room.rect.w, room.rect.h);
    const least = Math.min(rule.minWidth, rule.minDepth);
    if (narrow < least - 1e-6)
      issues.push({
        code: "room_narrow",
        severity: "warn",
        kinds: [room.kind],
        roomIds: [room.id],
        measured: round(narrow),
        target: least,
        shortfall: (least - narrow) / least,
        message: `${room.name} is only ${round(narrow)} m across; ${least} m is the least that works.`,
      });
  }

  const wishes: { a: RoomKind; b: RoomKind; weight: number; chosen: boolean }[] = [];
  for (const kind of new Set(plan.rooms.map((r) => r.kind)))
    for (const b of KIND_RULES[kind].adjacent)
      wishes.push({ a: kind, b, weight: 1, chosen: false });
  for (const p of program.preferences.adjacent)
    wishes.push({ a: p.a, b: p.b, weight: p.weight, chosen: true });
  for (const wish of wishes)
    for (const room of plan.rooms.filter((r) => r.kind === wish.a)) {
      const others = plan.rooms.filter((o) => o.id !== room.id && o.kind === wish.b);
      if (others.length === 0) continue;
      if (!others.some((o) => facingSpan(room.rect, o.rect, ADJACENT_GAP_M) >= 1.5))
        issues.push({
          code: "adjacency_missed",
          severity: "warn",
          kinds: [wish.a, wish.b],
          roomIds: [room.id],
          measured: 0,
          target: 1,
          shortfall: Math.min(1, wish.weight / 2),
          message: `${room.name} is not next to a ${KIND_RULES[wish.b].label.toLowerCase()}${wish.chosen ? " (a design preference)" : ""}.`,
        });
    }
  for (const keep of program.preferences.apart)
    for (const room of plan.rooms.filter((r) => r.kind === keep.a))
      if (
        plan.rooms.some(
          (o) =>
            o.id !== room.id &&
            o.kind === keep.b &&
            facingSpan(room.rect, o.rect, ADJACENT_GAP_M) >= 1.5,
        )
      )
        issues.push({
          code: "apart_violated",
          severity: "warn",
          kinds: [keep.a, keep.b],
          roomIds: [room.id],
          measured: 1,
          target: 0,
          shortfall: Math.min(1, keep.weight / 2),
          message: `${room.name} touches a ${KIND_RULES[keep.b].label.toLowerCase()} it was meant to stay away from.`,
        });

  const workspace = plan.rooms
    .filter((r) => r.kind === "open_workspace" || r.kind === "private_office")
    .reduce((s, r) => s + r.rect.w * r.rect.h, 0);
  const perPerson = workspace / program.company.headcount;
  const { workspacePerPersonOkM2: ok, workspacePerPersonWarnM2: warn } = KNOWLEDGE.thresholds;
  if (perPerson < ok)
    issues.push({
      code: "workspace_density",
      severity: perPerson < warn ? "fail" : "warn",
      kinds: ["open_workspace"],
      roomIds: plan.rooms.filter((r) => r.kind === "open_workspace").map((r) => r.id),
      measured: round(perPerson),
      target: ok,
      shortfall: (ok - perPerson) / ok,
      message: `${round(perPerson)} m2 of workspace per person; ${ok} m2 is the planning minimum.`,
    });

  if (report.seatsPlaced < report.seatsWanted)
    issues.push({
      code: "seats_short",
      severity: report.seatsPlaced >= report.seatsWanted * 0.9 ? "warn" : "fail",
      kinds: ["open_workspace"],
      roomIds: plan.rooms.filter((r) => r.kind === "open_workspace").map((r) => r.id),
      measured: report.seatsPlaced,
      target: report.seatsWanted,
      shortfall: 1 - report.seatsPlaced / report.seatsWanted,
      message: `Only ${report.seatsPlaced} of ${report.seatsWanted} workstations fit with aisles.`,
    });

  for (const room of plan.rooms) {
    if (KIND_RULES[room.kind].daylight !== "required") continue;
    const exposure = plan.shell.windows.reduce(
      (s, side) => s + exposureOnSide(room.rect, shell, side),
      0,
    );
    if (exposure <= 0)
      issues.push({
        code: "daylight_missing",
        severity: "fail",
        kinds: [room.kind],
        roomIds: [room.id],
        measured: 0,
        target: 1,
        shortfall: 1,
        message: `${room.name} needs daylight and touches no window wall.`,
      });
  }

  // Whether the program can fit the shell at all, before any arrangement is tried.
  const minimum = expandRooms(program).reduce(
    (sum, r) => sum + r.targetAreaM2 * KIND_RULES[r.kind].minScale,
    0,
  );
  const capacity = shell.w * shell.h * 0.92;
  if (minimum > capacity)
    issues.push({
      code: "program_too_big",
      severity: "fail",
      kinds: [],
      roomIds: [],
      measured: round(capacity),
      target: round(minimum),
      shortfall: (minimum - capacity) / capacity,
      message: `The rooms need at least ${Math.round(minimum)} m2 even at their smallest, but the shell offers about ${Math.round(capacity)} m2 after circulation.`,
    });

  const reach = reachable(plan);
  const stranded = plan.rooms.filter((r) => !reach.has(r.id));
  if (stranded.length)
    issues.push({
      code: "unreachable",
      severity: "fail",
      kinds: stranded.map((r) => r.kind),
      roomIds: stranded.map((r) => r.id),
      measured: plan.rooms.length - stranded.length,
      target: plan.rooms.length,
      shortfall: stranded.length / plan.rooms.length,
      message: `Cannot reach from the front door: ${stranded.map((r) => r.name).join(", ")}.`,
    });
  if (plan.diagnostics.some((d) => d.level === "fail"))
    issues.push({
      code: "crowded",
      severity: "fail",
      kinds: [],
      roomIds: [],
      measured: 0,
      target: 1,
      shortfall: 1,
      message:
        "Some rows cannot fit their rooms even at minimum widths: the shell is too small for this program.",
    });
  return issues;
}

/** One number for how bad a plan is, so changes can be compared. Lower is better; `info` costs nothing. */
export function issueCost(issues: Issue[]): number {
  let total = 0;
  for (const issue of issues) {
    if (issue.severity === "info") continue;
    total += (issue.severity === "fail" ? 10 : 3) * (1 + 3 * Math.max(0, issue.shortfall));
  }
  return Math.round(total * 100) / 100;
}
