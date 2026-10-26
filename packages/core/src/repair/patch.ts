import { z } from "zod";
import { ROOM_KINDS } from "../catalog";
import type { Program } from "../program";

const Kind = z.enum(ROOM_KINDS);

/**
 * The only changes the repair loop may make. The set is closed on purpose: it can steer the
 * solver (bias floor area, ask for or against neighbours), and enlarge a shell whose size was only
 * assumed. It cannot add or remove rooms, shrink a shell, change a stated shell or change the
 * headcount, because those are the user's facts.
 */
export const OpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("scale_area"), kind: Kind, factor: z.number().min(0.7).max(1.4) }),
  z.object({
    op: z.literal("prefer_adjacent"),
    a: Kind,
    b: Kind,
    weight: z.number().min(0.5).max(3).optional(),
  }),
  z.object({
    op: z.literal("prefer_apart"),
    a: Kind,
    b: Kind,
    weight: z.number().min(0.5).max(3).optional(),
  }),
  /** Enlarge the shell by this factor of floor area. Honoured only when the shell size was assumed, never when stated. */
  z.object({ op: z.literal("grow_shell"), factor: z.number().min(1.05).max(1.6) }),
]);
export type Op = z.infer<typeof OpSchema>;

export const PatchSchema = z.object({
  ops: z.array(OpSchema).max(6),
  /** Why, in a sentence, shown to the user in the design trace. */
  reason: z.string().max(240),
});
export type Patch = z.infer<typeof PatchSchema>;

const SCALE_MIN = 0.6;
const SCALE_MAX = 1.6;

/** True when the user gave the shell size, so it must not be changed. */
export function shellIsStated(program: Program): boolean {
  return program.assumptions.some((a) => a.topic === "shell" && a.source === "brief");
}

/** Apply a patch to a program without mutating it. Always returns a valid program. */
export function applyPatch(program: Program, patch: Patch): Program {
  let shell = program.shell;
  const prefs = {
    adjacent: program.preferences.adjacent.map((p) => ({ ...p })),
    apart: program.preferences.apart.map((p) => ({ ...p })),
    areaScale: { ...program.preferences.areaScale },
  };
  for (const op of patch.ops) {
    if (op.op === "grow_shell") {
      if (shellIsStated(program)) continue;
      const side = Math.sqrt(op.factor);
      const grow = (m: number) => Math.min(80, Math.ceil((m * side) / 0.5) * 0.5);
      shell = { ...shell, widthM: grow(shell.widthM), depthM: grow(shell.depthM) };
    } else if (op.op === "scale_area") {
      const next = (prefs.areaScale[op.kind] ?? 1) * op.factor;
      prefs.areaScale[op.kind] = Math.min(
        SCALE_MAX,
        Math.max(SCALE_MIN, Math.round(next * 1000) / 1000),
      );
    } else {
      const list = op.op === "prefer_adjacent" ? prefs.adjacent : prefs.apart;
      if (op.a === op.b && op.op === "prefer_adjacent") continue;
      const found = list.find((p) => p.a === op.a && p.b === op.b);
      if (found) found.weight = Math.min(3, found.weight + (op.weight ?? 1));
      else if (list.length < 8)
        list.push({ a: op.a, b: op.b, weight: Math.min(3, op.weight ?? 1) });
    }
  }
  return { ...program, shell, preferences: prefs };
}

/** A short human description of a patch, for the design trace. */
export function describePatch(patch: Patch): string {
  const name = (k: string) => k.replace(/_/g, " ");
  return patch.ops
    .map((op) =>
      op.op === "grow_shell"
        ? `enlarge the shell by ${Math.round((op.factor - 1) * 100)}% of floor area`
        : op.op === "scale_area"
          ? `${op.factor >= 1 ? "give" : "take from"} ${name(op.kind)} (x${op.factor})`
          : `${op.op === "prefer_adjacent" ? "put" : "keep"} ${name(op.a)} ${op.op === "prefer_adjacent" ? "next to" : "away from"} ${name(op.b)}`,
    )
    .join("; ");
}
