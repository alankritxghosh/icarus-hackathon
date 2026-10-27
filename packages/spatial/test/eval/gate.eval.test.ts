import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  applyEdit,
  diagnose,
  type EditOp,
  type Evaluation,
  evaluateProgram,
  type FloorPlan,
  furnish,
  type Issue,
  issueCost,
  readBrief,
  refineDesign,
  understandEdit,
} from "@icarus/core";
import { describe, expect, it } from "vitest";
import { EVAL_BRIEFS } from "../../../../apps/web/test/eval/briefs";
import {
  circulationGraph,
  fromFloorPlan,
  type Kernel,
  snapPlanToMm,
  toFloorPlan,
  validate,
} from "../../src";
import { testKernel } from "../kernelSetup";
import { samePlan } from "../samePlan";

/**
 * The migration gate. Two parts, run on the real evaluation sets:
 *  1. UNCHANGED: the engine still produces the recorded results (design set A and B scores; edit set
 *     tallies), so introducing the spatial model changed nothing about what the product does.
 *  2. THROUGH THE MODEL: every plan those sets produce converts to a spatial model, validates with
 *     no errors, is reachable by doors, converts back to the same plan within a millimetre, and
 *     measures the same issues when diagnosed again.
 * Set SPATIAL_GATE_OUT to a file for the results; skipped otherwise, so a fresh clone passes.
 */
const out = process.env.SPATIAL_GATE_OUT;
const suite = out ? describe : describe.skip;
const ref = (p: string) =>
  JSON.parse(readFileSync(new URL(`../../../../docs/reference/${p}`, import.meta.url), "utf8"));

const issueKey = (issues: Issue[]) =>
  issues
    .filter((i) => i.severity !== "info")
    .map((i) => `${i.severity}:${i.code}:${[...i.roomIds].sort().join(",")}`)
    .sort();

interface Tally {
  plans: number;
  modelErrors: string[];
  unreachable: string[];
  roundTripDiffs: string[];
  /** Round trip of a plan already on the millimetre grid, which must be exact. */
  exactDiffs: string[];
  unsupported: string[];
  /** Issues that differ between the grid-snapped plan and its round trip. Must be empty. */
  issueDiffs: string[];
  /** Plans whose measured issues change merely by snapping to the grid (an engine property). */
  snapSensitive: string[];
  maxCostDrift: number;
}
const fresh = (): Tally => ({
  plans: 0,
  modelErrors: [],
  unreachable: [],
  roundTripDiffs: [],
  exactDiffs: [],
  unsupported: [],
  issueDiffs: [],
  snapSensitive: [],
  maxCostDrift: 0,
});

function throughModel(label: string, ev: Evaluation, k: Kernel, t: Tally) {
  t.plans++;
  const model = fromFloorPlan(ev.plan, { program: ev.program });
  for (const f of validate(model, k).findings)
    if (f.level === "error") t.modelErrors.push(`${label}: ${f.code} ${f.message}`);
  const g = circulationGraph(model, k);
  if (g.unreachable.length) t.unreachable.push(`${label}: ${g.unreachable.join(",")}`);
  const back = toFloorPlan(model, { search: ev.plan.search, diagnostics: ev.plan.diagnostics });
  if (back.unsupported.length) t.unsupported.push(`${label}: ${back.unsupported.join("; ")}`);
  for (const d of samePlan(ev.plan, back.plan)) t.roundTripDiffs.push(`${label}: ${d}`);
  // (1) The adapter on a plan already on the grid: exact, and measures exactly the same.
  const snapped = snapPlanToMm(ev.plan);
  const m2 = fromFloorPlan(snapped, { program: ev.program });
  const back2 = toFloorPlan(m2, { search: ev.plan.search, diagnostics: ev.plan.diagnostics }).plan;
  for (const d of samePlan(snapped, back2, 1e-9)) t.exactDiffs.push(`${label}: ${d}`);
  const measure = (plan: FloorPlan) => {
    const issues = diagnose(plan, ev.program, furnish(plan, ev.program).report);
    return { key: issueKey(issues), cost: issueCost(issues) };
  };
  const onGrid = measure(snapped);
  const viaModel = measure(back2);
  if (onGrid.key.join("|") !== viaModel.key.join("|"))
    t.issueDiffs.push(`${label}: ${onGrid.key.join(",")} vs ${viaModel.key.join(",")}`);
  t.maxCostDrift = Math.max(t.maxCostDrift, Math.abs(onGrid.cost - viaModel.cost));
  // (2) How much snapping alone moves what the engine measures (no model involved).
  const original = issueKey(ev.issues);
  if (original.join("|") !== onGrid.key.join("|"))
    t.snapSensitive.push(
      `${label}: ${original.filter((x) => !onGrid.key.includes(x)).join(",")} -> ${onGrid.key.filter((x) => !original.includes(x)).join(",")}`,
    );
}

const SIDES = ["north", "south", "east", "west"] as const;
function parsed(text: string, base: Evaluation): { text: string; ops: EditOp[] }[] {
  const said = understandEdit(text, {
    phoneBooths: base.program.phoneBooths,
    meetingRooms: base.plan.rooms.filter((r) => r.kind === "meeting_room").length,
    names: base.plan.rooms.map((r) => r.name),
  });
  return said.kind === "edit" && said.ops.length ? [{ text, ops: said.ops }] : [];
}

suite("spatial model migration gate", () => {
  it("design set and edit set are unchanged and pass through the model", {
    timeout: 1_800_000,
  }, async () => {
    const k = await testKernel();
    mkdirSync(dirname(out as string), { recursive: true });
    const report: Record<string, unknown> = { generated: new Date().toISOString() };

    // ---- design set ---------------------------------------------------------------------
    const design = ref("design-loop-eval/run3-final-llama-workers-ai.json") as {
      name: string;
      A: { cost: number; open: number; fails: number };
      B: { cost: number; open: number; fails: number };
    }[];
    const dt = fresh();
    const designDrift: string[] = [];
    const open = (e: Evaluation) => e.issues.filter((i) => i.severity !== "info").length;
    const fails = (e: Evaluation) => e.issues.filter((i) => i.severity === "fail").length;
    for (const { name, brief } of EVAL_BRIEFS) {
      const program = readBrief(brief).program;
      const A = evaluateProgram(program, { seeds: [1, 2] });
      const B = (await refineDesign(program)).best;
      const r = design.find((d) => d.name === name);
      if (!r) throw new Error(`no reference for ${name}`);
      for (const [v, e, rr] of [
        ["A", A, r.A],
        ["B", B, r.B],
      ] as const) {
        if (Math.abs(e.cost - rr.cost) > 1e-9 || open(e) !== rr.open || fails(e) !== rr.fails)
          designDrift.push(
            `${name} ${v}: cost ${e.cost} vs ${rr.cost}, open ${open(e)} vs ${rr.open}, fails ${fails(e)} vs ${rr.fails}`,
          );
        throughModel(`${name} ${v}`, e, k, dt);
      }
    }
    report.design = {
      briefs: EVAL_BRIEFS.length,
      engineDriftFromRecordedRun: designDrift,
      throughModel: dt,
    };

    // ---- edit set -----------------------------------------------------------------------
    const editRef = ref("edit-eval/run2-with-resize-and-rooms.json") as {
      tally: Record<string, number>;
      byKind: Record<string, Record<string, number>>;
    };
    const et = fresh();
    const tally = { applied: 0, unchanged: 0, refused: 0, requests: 0, newFailures: 0 };
    const byKind: Record<string, Record<string, number>> = {};
    const failsOf = (e: Evaluation) =>
      e.issues
        .filter((i) => i.severity === "fail")
        .map((i) => `${i.code}:${[...i.roomIds].sort().join(",")}`)
        .sort();
    for (const { name, brief } of EVAL_BRIEFS) {
      const base = (await refineDesign(readBrief(brief).program)).best;
      const requests: { text: string; ops: EditOp[] }[] = [];
      const kinds = new Set(base.plan.rooms.map((r) => r.kind));
      for (const kind of ["kitchen", "lounge"] as const)
        if (kinds.has(kind))
          for (const side of SIDES) requests.push(...parsed(`move the ${kind} ${side}`, base));
      requests.push(...parsed("add a third phone booth", base));
      for (const text of [
        "make the kitchen bigger",
        "make the kitchen smaller",
        "make the lounge bigger",
        "add a meeting room",
        "remove a meeting room",
      ])
        if (kinds.has(text.includes("lounge") ? "lounge" : "kitchen"))
          requests.push(...parsed(text, base));
      if (kinds.has("reception") && kinds.has("lounge"))
        requests.push(...parsed("swap reception and lounge", base));
      if (kinds.has("reception") && kinds.has("kitchen"))
        requests.push(...parsed("swap reception and kitchen", base));
      for (const { text, ops } of requests) {
        const outcome = applyEdit(base, ops);
        const step = outcome.steps[0];
        const kind = text.startsWith("make")
          ? "resize"
          : text.startsWith("add a meeting") || text.startsWith("remove")
            ? "rooms"
            : text.startsWith("move")
              ? "move"
              : text.includes("booth")
                ? "booth"
                : "swap";
        byKind[kind] ??= { applied: 0, unchanged: 0, refused: 0 };
        const bucket = byKind[kind] as Record<string, number>;
        tally.requests++;
        if (step) {
          tally[step.status]++;
          bucket[step.status] = (bucket[step.status] ?? 0) + 1;
        }
        if (outcome.changed) {
          tally.newFailures += failsOf(outcome.evaluation).filter(
            (x) => !failsOf(base).includes(x),
          ).length;
          throughModel(`${name} :: ${text}`, outcome.evaluation, k, et);
        }
      }
    }
    report.edit = {
      tally,
      byKind,
      recorded: editRef.tally,
      recordedByKind: editRef.byKind,
      throughModel: et,
    };
    writeFileSync(out as string, JSON.stringify(report, null, 2));

    // ---- the gate -----------------------------------------------------------------------
    expect(designDrift).toEqual([]);
    expect(tally).toEqual(editRef.tally);
    expect(byKind).toEqual(editRef.byKind);
    for (const t of [dt, et]) {
      expect(t.modelErrors).toEqual([]);
      expect(t.unreachable).toEqual([]);
      expect(t.unsupported).toEqual([]);
      expect(t.roundTripDiffs).toEqual([]);
      expect(t.exactDiffs).toEqual([]);
      expect(t.issueDiffs).toEqual([]);
      expect(t.maxCostDrift).toBeLessThan(1e-9);
    }
    // Snapping to the grid must not change what the engine measures. (It did, for 1 plan in 110,
    // before furnishing counted a fit within a millimetre as a fit.)
    expect(dt.snapSensitive).toEqual([]);
    expect(et.snapSensitive).toEqual([]);
  });
});
