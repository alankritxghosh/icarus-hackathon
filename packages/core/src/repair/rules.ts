import type { FloorPlan } from "../layout/types";
import type { Issue } from "./diagnose";
import type { Op, Patch } from "./patch";

/**
 * The repairer that needs no model: for each kind of failure, the change that usually helps. A
 * model proposes patches through the same vocabulary; this is the fallback and the baseline it
 * has to beat. Nothing here is a guarantee; the loop measures every change and keeps only wins.
 */
export function repairByRules(issues: Issue[], plan?: FloorPlan): Patch {
  const ops: Op[] = [];
  const reasons: string[] = [];
  // Kinds that gave up the most, in order of how short they are; and kinds with slack to give.
  const grow = new Map<string, number>();
  const donors = new Set<string>();
  const slack = (plan?.rooms ?? []).filter((r) => (r.rect.w * r.rect.h) / r.targetAreaM2 > 1.1);
  for (const r of slack) donors.add(r.kind);
  for (const issue of issues) {
    if (issue.severity === "info") continue;
    if (issue.code === "program_too_big") {
      ops.push({
        op: "grow_shell",
        factor: Math.min(1.6, Math.max(1.05, (issue.target / issue.measured) * 1.08)),
      });
      reasons.push("the rooms cannot fit the shell");
    }
    if (issue.code === "crowded" && !ops.some((o) => o.op === "grow_shell")) {
      ops.push({ op: "grow_shell", factor: 1.2 });
      reasons.push("the rows cannot fit their rooms");
    }
    if (issue.code === "room_small" || issue.code === "room_narrow")
      for (const k of issue.kinds) grow.set(k, Math.max(grow.get(k) ?? 0, issue.shortfall));
    if (issue.code === "seats_short" || issue.code === "workspace_density") {
      grow.set("open_workspace", Math.max(grow.get("open_workspace") ?? 0, issue.shortfall));
      for (const k of ["lounge", "storage", "kitchen"]) donors.add(k);
      reasons.push("not enough workspace");
    }
    if (issue.code === "adjacency_missed" && issue.kinds.length === 2) {
      const [a, b] = issue.kinds;
      if (a && b && !ops.some((o) => o.op === "prefer_adjacent" && o.a === a && o.b === b)) {
        ops.push({ op: "prefer_adjacent", a, b, weight: 1 });
        reasons.push(`${a.replace(/_/g, " ")} is not next to ${b.replace(/_/g, " ")}`);
      }
    }
    if (issue.code === "apart_violated" && issue.kinds.length === 2) {
      const [a, b] = issue.kinds;
      if (a && b && !ops.some((o) => o.op === "prefer_apart" && o.a === a && o.b === b))
        ops.push({ op: "prefer_apart", a, b, weight: 1 });
    }
  }
  // Many rooms short and none with slack means the shell is simply tight: ask for a bit more floor.
  if (grow.size >= 3 && donors.size === 0 && !ops.some((o) => o.op === "grow_shell")) {
    ops.push({ op: "grow_shell", factor: 1.15 });
    reasons.push("most rooms are short and none has slack");
  }
  // Moving floor between rooms only helps when some room has more than it needs.
  const takers = [...grow.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 2)
    .map(([k]) => k)
    .filter((k) => !donors.has(k));
  const givers = [...donors].filter((k) => !grow.has(k)).slice(0, 2);
  if (takers.length && givers.length) {
    for (const kind of takers) ops.push({ op: "scale_area", kind: kind as never, factor: 1.15 });
    for (const kind of givers) ops.push({ op: "scale_area", kind: kind as never, factor: 0.9 });
    reasons.push(`${takers.join(", ").replace(/_/g, " ")} is too small`);
  }
  return {
    ops: ops.slice(0, 6),
    reason: reasons.length
      ? `Rules: ${[...new Set(reasons)].join("; ")}.`
      : "Rules: nothing to adjust.",
  };
}
