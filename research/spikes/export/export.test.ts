// Exports the 12 evaluation briefs from the real engine as plain JSON, so spikes in other
// languages solve exactly the same problems and can be compared with the baseline plan.
// Run: pnpm exec vitest run research/spikes/export/export.test.ts   (from the repo root)
import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import { EVAL_BRIEFS } from "../../../apps/web/test/eval/briefs";
import { evaluateProgram, expandRooms, KIND_RULES, readBrief } from "../../../packages/core/src";

describe("export briefs", () => {
  it("writes problems.json", { timeout: 300_000 }, () => {
    const problems = EVAL_BRIEFS.map(({ name, brief }) => {
      const { program } = readBrief(brief);
      const ev = evaluateProgram(program, { seeds: [1, 2] });
      return {
        name,
        brief,
        shell: program.shell,
        headcount: program.company.headcount,
        rooms: expandRooms(program).map((r) => ({
          id: r.id,
          kind: r.kind,
          name: r.name,
          targetAreaM2: r.targetAreaM2,
          capacity: r.capacity ?? null,
        })),
        baseline: {
          plan: {
            rooms: ev.plan.rooms.map((r) => ({ id: r.id, kind: r.kind, rect: r.rect, door: r.door })),
            circulation: ev.plan.circulation,
            entrance: ev.plan.entrance,
          },
          issueScore: ev.cost,
          issues: ev.issues.filter((i) => i.severity !== "info").length,
        },
      };
    });
    const kinds = Object.fromEntries(Object.entries(KIND_RULES));
    mkdirSync("research/results", { recursive: true });
    writeFileSync("research/results/problems.json", JSON.stringify({ kinds, problems }, null, 1));
  });
});
