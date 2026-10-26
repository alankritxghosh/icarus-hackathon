import { writeFileSync } from "node:fs";
import {
  applyEdit,
  type EditOp,
  type Evaluation,
  readBrief,
  refineDesign,
  understandEdit,
} from "@icarus/core";
import { describe, it } from "vitest";
import { EVAL_BRIEFS } from "./briefs";

/**
 * Measures what editing by words does on the twelve evaluation briefs: how many requests are
 * applied, left unchanged or refused (and why), what the edit does to the measured score, whether
 * any edit ever introduced a failure, and how long one edit takes. Needs no model. Set
 * EDIT_EVAL_OUT to a file for the results; skipped otherwise, so a fresh clone passes.
 */
const out = process.env.EDIT_EVAL_OUT;
const suite = out ? describe : describe.skip;

const SIDES = ["north", "south", "east", "west"] as const;
const fails = (e: Evaluation) =>
  e.issues
    .filter((i) => i.severity === "fail")
    .map((i) => `${i.code}:${[...i.roomIds].sort().join(",")}`)
    .sort();

function reasonClass(message: string): string {
  if (message.includes("locked in place")) return "locked room would move";
  if (message.includes("entrance lobby")) return "reception off the entrance lobby";
  if (message.startsWith("Every arrangement")) return "every arrangement breaks something";
  if (message.startsWith("No arrangement")) return "no arrangement does this";
  if (message.includes("fit along")) return "no wall space for the booth";
  return "other";
}

suite("edit by words evaluation", () => {
  it("measures the headline requests on twelve briefs", { timeout: 1_800_000 }, async () => {
    const rows: unknown[] = [];
    const tally = { applied: 0, unchanged: 0, refused: 0, requests: 0, newFailures: 0 };
    const reasons: Record<string, number> = {};
    const deltas: number[] = [];
    const times: number[] = [];
    for (const { name, brief } of EVAL_BRIEFS) {
      const read = readBrief(brief);
      const base = (await refineDesign(read.program)).best;
      const requests: { text: string; ops: EditOp[] }[] = [];
      const kinds = new Set(base.plan.rooms.map((r) => r.kind));
      for (const kind of ["kitchen", "lounge"] as const)
        if (kinds.has(kind))
          for (const side of SIDES) requests.push(...parsed(`move the ${kind} ${side}`, base));
      requests.push(...parsed(`add a third phone booth`, base));
      if (kinds.has("reception") && kinds.has("lounge"))
        requests.push(...parsed("swap reception and lounge", base));
      if (kinds.has("reception") && kinds.has("kitchen"))
        requests.push(...parsed("swap reception and kitchen", base));
      const results = requests.map(({ text, ops }) => {
        const started = performance.now();
        const outcome = applyEdit(base, ops);
        const ms = performance.now() - started;
        times.push(ms);
        const step = outcome.steps[0];
        tally.requests++;
        if (step) tally[step.status]++;
        const status = step?.status ?? "none";
        if (status === "refused" && step) {
          const why = reasonClass(step.message);
          reasons[why] = (reasons[why] ?? 0) + 1;
        }
        const introduced = outcome.changed
          ? fails(outcome.evaluation).filter((k) => !fails(base).includes(k))
          : [];
        tally.newFailures += introduced.length;
        if (outcome.changed) deltas.push(outcome.evaluation.cost - base.cost);
        return {
          text,
          status,
          scoreDelta: outcome.changed
            ? Math.round((outcome.evaluation.cost - base.cost) * 10) / 10
            : null,
          introduced,
          ms: Math.round(ms),
          message: step?.message.slice(0, 160),
        };
      });
      rows.push({ name, startScore: Math.round(base.cost * 10) / 10, results });
    }
    deltas.sort((a, b) => a - b);
    const median = deltas.length ? (deltas[Math.floor(deltas.length / 2)] ?? 0) : 0;
    times.sort((a, b) => a - b);
    writeFileSync(
      out as string,
      JSON.stringify(
        {
          tally,
          refusalReasons: reasons,
          medianScoreDelta: Math.round(median * 10) / 10,
          betterOrEqual: deltas.filter((d) => d <= 0.01).length,
          appliedCount: deltas.length,
          medianMs: Math.round(times[Math.floor(times.length / 2)] ?? 0),
          p95Ms: Math.round(times[Math.floor(times.length * 0.95)] ?? 0),
          rows,
        },
        null,
        2,
      ),
    );
  });
});

function parsed(text: string, base: Evaluation): { text: string; ops: EditOp[] }[] {
  const said = understandEdit(text, {
    phoneBooths: base.program.phoneBooths,
    names: base.plan.rooms.map((r) => r.name),
  });
  return said.kind === "edit" && said.ops.length ? [{ text, ops: said.ops }] : [];
}
