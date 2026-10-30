import type { Scene } from "@icarus/core";
import { type AccountLesson, kindMatches, ruleFromWords, teach } from "@icarus/spatial/model";

/**
 * Icarus learns from what a person types. Any sentence that states a preference ("never put plants in the kitchen",
 * "always put a bin in the kitchen", "no carpet in the kitchen") is kept as a lesson for this person, with their own
 * words, and applied from then on. Sentences that are requests for a change are left to the editor.
 */
export function learnFrom(
  text: string,
  lessons: AccountLesson[],
): { lessons: AccountLesson[]; added: AccountLesson[]; onlyPreferences: boolean } {
  let next = lessons;
  const added: AccountLesson[] = [];
  const sentences = text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  let understood = 0;
  for (const sentence of sentences) {
    const rule = ruleFromWords(sentence);
    if (!rule) continue;
    understood++;
    if (next.some((l) => JSON.stringify(l.rule) === JSON.stringify(rule))) continue;
    const taught = teach(next, sentence);
    if (taught.added) {
      next = taught.lessons;
      added.push(taught.added);
    }
  }
  return {
    lessons: next,
    added,
    onlyPreferences: sentences.length > 0 && understood === sentences.length,
  };
}

/**
 * Applies what has been taught to a built scene: an item a rule forbids is taken out of the rooms it forbids it in.
 * `touched` names the lessons that changed something, so Icarus can say so.
 */
export function applyTaught(
  scene: Scene,
  lessons: readonly AccountLesson[],
): { scene: Scene; touched: string[] } {
  const forbids = lessons.flatMap((l) =>
    l.rule.type === "forbid-item" ? [{ id: l.id, rule: l.rule }] : [],
  );
  if (!forbids.length) return { scene, touched: [] };
  const touched = new Set<string>();
  const nodes = scene.nodes.filter((n) => {
    if (n.type !== "furniture" && n.type !== "fixture") return true;
    const kind = n.tags[1] ?? n.name;
    for (const f of forbids) {
      if (kind !== f.rule.itemKind) continue;
      if (
        f.rule.inSpaceKind &&
        !(n.roomKind && kindMatches(f.rule.inSpaceKind, `office.${n.roomKind}`))
      )
        continue;
      touched.add(f.id);
      return false;
    }
    return true;
  });
  return touched.size
    ? { scene: { ...scene, nodes }, touched: [...touched] }
    : { scene, touched: [] };
}
