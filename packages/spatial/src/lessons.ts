// Corrections the people using Icarus have given, kept as rules the software enforces. A correction is
// not just fixed once in one drawing: it becomes a lesson with the words that prompted it, the rule, the
// reason, and where it is held, so the same mistake is caught in every later model.
//
// A lesson is one of: a check run over the model here, an audit rule (drawingAudit.ts), or a test. The
// scope says which buildings it concerns, so a taste about houses does not strip plants from an office.
import type { SpatialModel } from "./schema";
import type { Finding } from "./validate";

type Item = SpatialModel["items"][number];
type Space = SpatialModel["spaces"][number];

export interface Lesson {
  id: string;
  /** Date the correction was given. */
  date: string;
  /** The person's own words, short. */
  said: string;
  rule: string;
  why: string;
  /** "residential": spaces whose kind starts "residential."; "any": every model. */
  scope: "any" | "residential";
  enforcement: "check" | "audit" | "test";
  heldBy: string;
  check?: (model: SpatialModel) => Finding[];
}

const GREENERY = /(^|[._-])(plant|shrub|tree|turf|grass|hedge)([._-]|$)/i;
const SOFAS = new Set(["sofa", "sofa_l", "l_sofa"]);

const spaceOf = (m: SpatialModel, i: Item): Space | undefined =>
  m.spaces.find((s) => s.id === i.spaceId);

/** The unit vector the front of an item points along on the plan (see Item: 0 faces +y, positive turns clockwise). */
const frontOf = (i: Item): [number, number] => {
  const r = (i.rotationDeg * Math.PI) / 180;
  return [-Math.sin(r), Math.cos(r)];
};

const violation = (lesson: string, message: string, ...ids: string[]): Finding => ({
  level: "error",
  code: lesson,
  message,
  ids,
});

export const LESSONS: readonly Lesson[] = [
  {
    id: "L-follow-the-drawing",
    date: "2026-10-29",
    said: "we need not improvise if we quite literally are being given the floor plan",
    rule: "When a drawing is supplied it is the specification: draw every wall it draws and none it does not, keep open spaces open, name rooms as labelled, never invent.",
    why: "Walls added where the sheet had none, a missed wardrobe and a mis-turned bed were all improvisation.",
    scope: "any",
    enforcement: "audit",
    heldBy: "auditAgainstDrawing (drawingAudit.ts)",
  },
  {
    id: "L-indoor-floors-hard-or-soft",
    date: "2026-10-30",
    said: "INSIDE THE HOUSE IT MUST ALWAYS BE TILES, or wooden flooring, do not have any grass inside",
    rule: "Inside a building a floor is tile, wood, carpet, concrete, stone or terrazzo. Turf and gravel belong only to spaces of kind exterior.*.",
    why: "A strip of the drawing coloured green was built as grass inside the walls.",
    scope: "any",
    enforcement: "check",
    heldBy: "checkLessons: indoor-floors; Space.floorFinish",
    check: (m) =>
      m.spaces
        .filter(
          (s) =>
            (s.floorFinish === "turf" || s.floorFinish === "gravel") &&
            !s.kind.startsWith("exterior."),
        )
        .map((s) =>
          violation(
            "L-indoor-floors-hard-or-soft",
            `"${s.name}" has a ${s.floorFinish} floor inside the building`,
            s.id,
          ),
        ),
  },
  {
    id: "L-no-greenery-in-homes",
    date: "2026-10-30",
    said: "why the fuck is there any plant inside the house",
    rule: "A house has no plants, shrubs, trees or grass inside it. (Offices keep their plants; this lesson is for residential spaces.)",
    why: "Plants beside and between the stairs, and a grass court, were unwanted and read as improvised.",
    scope: "residential",
    enforcement: "check",
    heldBy: "checkLessons: no-greenery-in-homes",
    check: (m) =>
      m.items
        .filter((i) => GREENERY.test(i.kind) && spaceOf(m, i)?.kind.startsWith("residential."))
        .map((i) =>
          violation(
            "L-no-greenery-in-homes",
            `a ${i.kind} stands inside the house in "${spaceOf(m, i)?.name}"`,
            i.id,
          ),
        ),
  },
  {
    id: "L-clear-stairs",
    date: "2026-10-26",
    said: "it is currently blocking the staircase",
    rule: "Nothing stands on a stair, a lift lobby or within 150 mm of their footprint.",
    why: "Circulation comes before decoration; a stair must be usable and clear.",
    scope: "any",
    enforcement: "check",
    heldBy: "checkLessons: clear-stairs",
    check: (m) =>
      m.items.flatMap((i) =>
        m.connectors
          .filter((c) => c.kind !== "ramp")
          .flatMap((c) => c.serves.filter((s) => s.levelId === spaceOf(m, i)?.levelId))
          .filter((s) => {
            const xs = s.footprint.outer.map((v) => v.x);
            const ys = s.footprint.outer.map((v) => v.y);
            const half = Math.max(i.sizeMm.w, i.sizeMm.d) / 2;
            return (
              i.at.x + half > Math.min(...xs) - 150 &&
              i.at.x - half < Math.max(...xs) + 150 &&
              i.at.y + half > Math.min(...ys) - 150 &&
              i.at.y - half < Math.max(...ys) + 150
            );
          })
          .map(() =>
            violation(
              "L-clear-stairs",
              `${i.kind} ${i.id} stands on or against a stair or lift`,
              i.id,
            ),
          ),
      ),
  },
  {
    id: "L-sofa-faces-a-television",
    date: "2026-10-30",
    said: "the couch is facing a blank wall, there must be a television there",
    rule: "Every sofa faces a television on a media unit, 1.5 to 6 m in front of it and roughly on its axis, turned back toward it.",
    why: "A sofa facing a blank wall reads as an unfinished room.",
    scope: "any",
    enforcement: "check",
    heldBy: "checkLessons: sofa-faces-a-television",
    check: (m) =>
      m.items
        .filter((i) => SOFAS.has(i.kind))
        .filter((sofa) => {
          const [fx, fy] = frontOf(sofa);
          return !m.items.some((t) => {
            if (t.kind !== "tv_unit" || t.spaceId !== sofa.spaceId) return false;
            const dx = (t.at.x - sofa.at.x) / 1000;
            const dy = (t.at.y - sofa.at.y) / 1000;
            const along = dx * fx + dy * fy;
            const across = Math.abs(-dx * fy + dy * fx);
            const [tx, ty] = frontOf(t);
            return along > 1.5 && along < 6 && across < 1.2 && tx * fx + ty * fy < -0.7;
          });
        })
        .map((sofa) =>
          violation(
            "L-sofa-faces-a-television",
            `sofa ${sofa.id} faces a wall with no television`,
            sofa.id,
          ),
        ),
  },
  {
    id: "L-gym-has-equipment",
    date: "2026-10-30",
    said: "add a few equipments inside the GYM room too",
    rule: "A gym holds exercise equipment: treadmills, a bike, a bench with a barbell, dumbbells, a mat.",
    why: "An empty gym reads as an unfinished room.",
    scope: "any",
    enforcement: "audit",
    heldBy: "auditAgainstDrawing: space_without_expected_item (EXPECTED_CONTENTS)",
  },
];

const concerns = (lesson: Lesson, m: SpatialModel) =>
  lesson.scope === "any" || m.spaces.some((s) => s.kind.startsWith("residential."));

/** Runs every lesson that has a check and applies to this model. An empty result means nothing taught has been broken. */
export function checkLessons(model: SpatialModel): Finding[] {
  return LESSONS.filter((l) => l.check && concerns(l, model)).flatMap((l) =>
    (l.check as NonNullable<Lesson["check"]>)(model),
  );
}
