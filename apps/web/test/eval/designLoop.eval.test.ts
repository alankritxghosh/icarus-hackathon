import { existsSync, writeFileSync } from "node:fs";
import { evaluateProgram, readBrief, refineDesign } from "@icarus/core";
import { describe, it } from "vitest";
import { designFromBrief } from "../../src/designLoop";
import { EVAL_BRIEFS } from "./briefs";

/**
 * Compares three ways of designing the same briefs: (A) the rules alone with no repair, (B) the
 * deterministic repair loop, (C) the full loop with the live model proposing and revising.
 * Needs the Worker with a model key: set EVAL_EDGE (for example http://localhost:8789) and
 * EVAL_OUT (a file for the results). Skipped otherwise, so a fresh clone passes.
 */
const edge = process.env.EVAL_EDGE;
const suite = edge ? describe : describe.skip;

const open = (e: { issues: { severity: string }[] }) =>
  e.issues.filter((i) => i.severity !== "info").length;
const fails = (e: { issues: { severity: string }[] }) =>
  e.issues.filter((i) => i.severity === "fail").length;

suite("design loop evaluation", () => {
  it("scores three variants on twelve briefs", { timeout: 1_800_000 }, async () => {
    const fetcher = ((path: string, init?: RequestInit) =>
      fetch(`${edge}${path}`, init)) as typeof fetch;
    const rows: unknown[] = [];
    for (const { name, brief } of EVAL_BRIEFS) {
      const read = readBrief(brief);
      const started = performance.now();
      const A = evaluateProgram(read.program, { seeds: [1, 2] });
      const tB = performance.now();
      const B = await refineDesign(read.program);
      const tC = performance.now();
      const C = await designFromBrief(brief, { fetcher });
      const end = performance.now();
      rows.push({
        name,
        shellStated: read.program.assumptions.some(
          (a) => a.topic === "shell" && a.source === "brief",
        ),
        A: {
          cost: A.cost,
          open: open(A),
          fails: fails(A),
          seats: `${A.furnished.report.seatsPlaced}/${A.furnished.report.seatsWanted}`,
          shell: `${A.program.shell.widthM}x${A.program.shell.depthM}`,
        },
        B: {
          cost: B.best.cost,
          open: open(B.best),
          fails: fails(B.best),
          seats: `${B.best.furnished.report.seatsPlaced}/${B.best.furnished.report.seatsWanted}`,
          shell: `${B.best.program.shell.widthM}x${B.best.program.shell.depthM}`,
          suggestions: B.suggestions.length,
          ms: Math.round(tC - tB),
        },
        C: {
          cost: C.refine.best.cost,
          open: open(C.refine.best),
          fails: fails(C.refine.best),
          seats: `${C.refine.best.furnished.report.seatsPlaced}/${C.refine.best.furnished.report.seatsWanted}`,
          shell: `${C.refine.best.program.shell.widthM}x${C.refine.best.program.shell.depthM}`,
          suggestions: C.refine.suggestions.length,
          proposal: C.trace.proposal,
          note: C.trace.note,
          vetoed: C.trace.vetoed.length,
          decisions: C.trace.decisions.length,
          revisions: C.trace.revisions,
          ms: Math.round(end - tC),
        },
        totalMs: Math.round(end - started),
      });
      writeFileSync(
        process.env.EVAL_OUT ?? "/tmp/design-loop-eval.json",
        JSON.stringify(rows, null, 1),
      );
    }
    if (!existsSync(process.env.EVAL_OUT ?? "/tmp/design-loop-eval.json"))
      throw new Error("no results written");
  });
});
