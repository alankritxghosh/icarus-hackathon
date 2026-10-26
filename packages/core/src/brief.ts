import type { Side } from "./geometry";
import { type Assumption, type Program, ProgramSchema, type RoomRequest } from "./program";

/**
 * A deterministic reader for a plain-language office brief. It is the offline stand-in behind the
 * same contract the model extraction will use: it returns a validated Program, and every value
 * the brief did not state is recorded as an assumption instead of being invented silently.
 */

const WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twelve: 12,
};
const SIDES: Side[] = ["north", "south", "east", "west"];
const NUMBER = "(\\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|twelve)";

const clamp = (n: number) => Math.min(80, Math.max(6, n));
const toNumber = (token: string) => WORDS[token] ?? Number(token);

function countBefore(text: string, nouns: string): number | undefined {
  const m = new RegExp(`\\b${NUMBER}\\s+(?:[a-z]+\\s+)?(?:${nouns})\\b`).exec(text);
  return m?.[1] ? toNumber(m[1]) : undefined;
}

function sidesIn(text: string): Side[] {
  return SIDES.filter((s) => new RegExp(`\\b${s}\\b`).test(text));
}

export interface ReadBrief {
  program: Program;
  /** Plain statements of what was read and what was assumed, for display. */
  notes: string[];
}

export function readBrief(brief: string): ReadBrief {
  const text = brief.toLowerCase().replace(/[×]/g, "x");
  const assumptions: Assumption[] = [];
  const assume = (topic: string, statement: string, source: Assumption["source"]) =>
    assumptions.push({ topic, statement, source, confidence: source === "brief" ? 0.95 : 0.6 });

  const people =
    /\b(\d{1,3})[\s-]*(?:people|person|staff|employees|team members|seats|designers|engineers)\b/.exec(
      text,
    );
  const headcount = people?.[1] ? Number(people[1]) : 20;
  assume(
    "headcount",
    people ? `${headcount} people, as stated.` : "No headcount was given; 20 people assumed.",
    people ? "brief" : "catalog",
  );

  const size = /(\d+(?:\.\d+)?)\s*(?:m|metres?|meters?)?\s*(?:by|x)\s*(\d+(?:\.\d+)?)/.exec(text);
  let widthM: number;
  let depthM: number;
  if (size?.[1] && size[2]) {
    widthM = clamp(Number(size[1]));
    depthM = clamp(Number(size[2]));
    assume(
      "shell",
      `${widthM} m by ${depthM} m shell, as stated (limited to 6 to 80 m a side).`,
      "brief",
    );
  } else {
    const area = headcount * 9.5;
    widthM = Math.max(6, Math.round(Math.sqrt(area * 1.5) * 2) / 2);
    depthM = Math.max(6, Math.round((area / widthM) * 2) / 2);
    assume(
      "shell",
      `No size was given; a ${widthM} m by ${depthM} m shell assumed (about 9.5 m2 per person).`,
      "catalog",
    );
  }

  const windowClause =
    /windows?(?:(?!entrance|entry|front door|main door)[^.;])*/.exec(text)?.[0] ?? "";
  const windowSides = sidesIn(windowClause);
  const windows = windowSides.length ? windowSides : (["south"] as Side[]);
  assume(
    "windows",
    windowSides.length
      ? `Windows on the ${windows.join(" and ")} wall${windows.length > 1 ? "s" : ""}, as stated.`
      : "No windows were mentioned; the south wall is assumed to be glazed.",
    windowSides.length ? "brief" : "catalog",
  );

  const entranceClause = /(?:entrance|entry|front door|main door)[^.;]*/.exec(text)?.[0] ?? "";
  const entranceSide = sidesIn(entranceClause)[0];
  const entrance = entranceSide ?? "west";
  assume(
    "entrance",
    entranceSide
      ? `Entrance on the ${entrance} wall, as stated.`
      : "No entrance was mentioned; the west wall is assumed.",
    entranceSide ? "brief" : "catalog",
  );

  const rooms: RoomRequest[] = [{ kind: "open_workspace", count: 1 }];
  const meetings = countBefore(text, "meeting rooms?|conference rooms?|meeting spaces?");
  const meetingCount = meetings ?? Math.max(1, Math.round(headcount / 10));
  rooms.push({ kind: "meeting_room", count: Math.min(meetingCount, 12), capacity: 6 });
  if (meetings === undefined)
    assume(
      "meeting rooms",
      `${meetingCount} meeting rooms assumed (one per ten people).`,
      "catalog",
    );

  const offices = countBefore(text, "private offices|offices");
  if (offices) rooms.push({ kind: "private_office", count: Math.min(offices, 12) });

  const mentioned = (re: RegExp) => re.test(text);
  const optional: [RegExp, RoomRequest["kind"], boolean][] = [
    [/kitchen|pantry|cafe/, "kitchen", true],
    [/lounge|breakout|social/, "lounge", false],
    [/reception|front desk/, "reception", true],
    [/storage|store room/, "storage", true],
    [/server|it closet|comms/, "server_room", false],
  ];
  for (const [re, kind, byDefault] of optional) {
    const stated = mentioned(re);
    if (stated || byDefault) rooms.push({ kind, count: 1 });
    if (!stated && byDefault)
      assume(
        kind.replace("_", " "),
        `A ${kind.replace("_", " ")} was not mentioned; one is included by default.`,
        "catalog",
      );
  }

  const restrooms = countBefore(text, "restrooms?|bathrooms?|toilets?|washrooms?");
  const restroomCount = restrooms ?? (headcount >= 15 ? 2 : 1);
  rooms.push({ kind: "restroom", count: Math.min(restroomCount, 4) });
  if (restrooms === undefined)
    assume(
      "restrooms",
      `${restroomCount} restroom${restroomCount > 1 ? "s" : ""} assumed.`,
      "catalog",
    );

  const booths = countBefore(text, "phone booths?|phone pods?|call booths?|focus booths?");
  const phoneBooths = Math.min(booths ?? Math.round(headcount / 15), 12);
  if (booths === undefined)
    assume("phone booths", `${phoneBooths} phone booths assumed.`, "catalog");

  const program = ProgramSchema.parse({
    company: { headcount },
    shell: { widthM, depthM, windows, entrance },
    rooms,
    phoneBooths,
    assumptions,
  });
  return { program, notes: assumptions.map((a) => a.statement) };
}
