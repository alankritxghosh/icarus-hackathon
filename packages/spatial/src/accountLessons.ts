// Lessons an account teaches its own Icarus. The built-in lessons (lessons.ts) are what everyone has been taught; these
// are one account's tastes and rules, kept as small validated data, never as code, so they can be stored in a browser
// or a database, shown to the person, and removed. Three kinds of rule exist, and no others: never put an item kind in
// a kind of space, always put one there, never use a floor finish there. An account can also switch off a built-in
// lesson, except the mandatory ones.
import { z } from "zod";
import type { SpatialModel } from "./schema";
import type { Finding } from "./validate";

export const ACCOUNT_LESSONS_VERSION = 1;
export const MAX_ACCOUNT_LESSONS = 50;

const Kind = z.string().min(1).max(60);
const Finish = z.enum([
  "tile",
  "wood",
  "carpet",
  "concrete",
  "stone",
  "terrazzo",
  "turf",
  "gravel",
]);

export const AccountRule = z.discriminatedUnion("type", [
  z.object({ type: z.literal("forbid-item"), itemKind: Kind, inSpaceKind: Kind.optional() }),
  z.object({ type: z.literal("require-item"), itemKind: Kind, inSpaceKind: Kind }),
  z.object({ type: z.literal("forbid-floor"), spaceKind: Kind, finish: Finish }),
  z.object({ type: z.literal("disable-built-in"), lesson: Kind }),
]);
export type AccountRule = z.infer<typeof AccountRule>;

export const AccountLesson = z.object({
  id: z.string().min(1).max(40),
  /** The person's own words. */
  said: z.string().min(3).max(300),
  rule: AccountRule,
  /** ISO date the lesson was taught. */
  date: z.string().max(40),
});
export type AccountLesson = z.infer<typeof AccountLesson>;

export const AccountLessons = z.object({
  version: z.literal(ACCOUNT_LESSONS_VERSION),
  lessons: z.array(AccountLesson).max(MAX_ACCOUNT_LESSONS),
});

/** Reads stored lessons, keeping the ones that are valid and counting the ones that are not. Never throws. */
export function parseAccountLessons(raw: unknown): { lessons: AccountLesson[]; dropped: number } {
  const list = (raw as { lessons?: unknown } | null)?.lessons;
  if (!Array.isArray(list)) return { lessons: [], dropped: raw == null ? 0 : 1 };
  const lessons: AccountLesson[] = [];
  let dropped = 0;
  for (const item of list.slice(0, MAX_ACCOUNT_LESSONS)) {
    const parsed = AccountLesson.safeParse(item);
    if (parsed.success) lessons.push(parsed.data);
    else dropped++;
  }
  return { lessons, dropped: dropped + Math.max(0, list.length - MAX_ACCOUNT_LESSONS) };
}

/** "meeting room" and "Meeting Rooms" both name the kind meeting_room; a trailing s is dropped unless it ends ss. */
const norm = (words: string): string => {
  const w = words
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, "_");
  return w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
};

/** A kind pattern: `office.*` matches every office space, `kitchen` matches any space whose kind ends in `.kitchen`. */
export function kindMatches(pattern: string, kind: string): boolean {
  if (pattern.includes("*")) {
    const re = new RegExp(
      `^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    );
    return re.test(kind);
  }
  return kind === pattern || kind.endsWith(`.${pattern}`);
}

const FINISHES = [
  "tile",
  "wood",
  "carpet",
  "concrete",
  "stone",
  "terrazzo",
  "turf",
  "gravel",
] as const;

/**
 * Turns a sentence into a rule, from a closed set of phrasings, or returns undefined. Examples:
 *   "never put plants in the kitchen"   "no sofa in a meeting room"   "always put a bin in the kitchen"
 *   "no carpet in the kitchen"          "turn off L-gym-has-equipment"
 */
export function ruleFromWords(text: string): AccountRule | undefined {
  const t = text
    .trim()
    .toLowerCase()
    .replace(/[.!]+$/, "");
  const off = /^(?:turn off|disable|stop checking)\s+(l-[a-z0-9-]+)$/.exec(t);
  if (off) return { type: "disable-built-in", lesson: `L${(off[1] as string).slice(1)}` };
  const floor =
    /^(?:never use|no|never put|don't use|do not use)\s+(?:a\s+|an\s+)?(\w+)\s+(?:floors?\s+)?(?:in|inside)\s+(?:the\s+|a\s+|an\s+|any\s+)?(.+)$/.exec(
      t,
    );
  if (floor && (FINISHES as readonly string[]).includes(floor[1] as string))
    return {
      type: "forbid-floor",
      spaceKind: norm(floor[2] as string),
      finish: floor[1] as (typeof FINISHES)[number],
    };
  const forbid =
    /^(?:never|don't|do not)\s+(?:put|place|add)\s+(?:a\s+|an\s+|any\s+)?(.+?)\s+(?:in|inside)\s+(?:the\s+|a\s+|an\s+|any\s+)?(.+)$/.exec(
      t,
    ) ?? /^no\s+(?:a\s+|an\s+)?(.+?)\s+(?:in|inside)\s+(?:the\s+|a\s+|an\s+|any\s+)?(.+)$/.exec(t);
  if (forbid)
    return {
      type: "forbid-item",
      itemKind: norm(forbid[1] as string),
      inSpaceKind: norm(forbid[2] as string),
    };
  const never = /^(?:never|don't|do not)\s+(?:use|have)\s+(?:a\s+|an\s+|any\s+)?(.+)$/.exec(t);
  if (never) return { type: "forbid-item", itemKind: norm(never[1] as string) };
  const require =
    /^always\s+(?:put|place|add|have)\s+(?:a\s+|an\s+)?(.+?)\s+(?:in|inside)\s+(?:the\s+|a\s+|an\s+|every\s+|each\s+)?(.+)$/.exec(
      t,
    );
  if (require)
    return {
      type: "require-item",
      itemKind: norm(require[1] as string),
      inSpaceKind: norm(require[2] as string),
    };
  return undefined;
}

/** Adds a lesson, or returns undefined when the sentence is not understood or the account is full. */
export function teach(
  lessons: readonly AccountLesson[],
  said: string,
  now: Date = new Date(),
): { lessons: AccountLesson[]; added?: AccountLesson } {
  const rule = ruleFromWords(said);
  if (!rule || lessons.length >= MAX_ACCOUNT_LESSONS) return { lessons: [...lessons] };
  const next = Math.max(0, ...lessons.map((l) => Number(/^A-(\d+)$/.exec(l.id)?.[1] ?? 0))) + 1;
  const added: AccountLesson = {
    id: `A-${next}`,
    said: said.trim().slice(0, 300),
    rule,
    date: now.toISOString().slice(0, 10),
  };
  return { lessons: [...lessons, added], added };
}

const violation = (lesson: AccountLesson, message: string, ...ids: string[]): Finding => ({
  level: "error",
  code: lesson.id,
  message,
  ids,
});

/** Findings for this account's own lessons (built-in switches are handled by checkLessons). */
export function checkAccountLessons(
  model: SpatialModel,
  lessons: readonly AccountLesson[],
): Finding[] {
  const out: Finding[] = [];
  const space = (id: string) => model.spaces.find((s) => s.id === id);
  for (const l of lessons) {
    const r = l.rule;
    if (r.type === "forbid-item") {
      for (const item of model.items) {
        if (item.kind !== r.itemKind) continue;
        const s = space(item.spaceId);
        if (r.inSpaceKind && !(s && kindMatches(r.inSpaceKind, s.kind))) continue;
        out.push(
          violation(l, `${l.said}: a ${item.kind} is in "${s?.name ?? item.spaceId}"`, item.id),
        );
      }
    } else if (r.type === "require-item") {
      for (const s of model.spaces) {
        if (!kindMatches(r.inSpaceKind, s.kind)) continue;
        if (!model.items.some((i) => i.spaceId === s.id && i.kind === r.itemKind))
          out.push(violation(l, `${l.said}: "${s.name}" has no ${r.itemKind}`, s.id));
      }
    } else if (r.type === "forbid-floor") {
      for (const s of model.spaces)
        if (s.floorFinish === r.finish && kindMatches(r.spaceKind, s.kind))
          out.push(violation(l, `${l.said}: "${s.name}" has a ${r.finish} floor`, s.id));
    }
  }
  return out;
}
