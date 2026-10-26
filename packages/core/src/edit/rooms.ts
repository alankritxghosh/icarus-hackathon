import type { RoomKind } from "../catalog";
import type { FloorPlan } from "../layout/types";

/** Words people use for each kind of room. Longest phrases are matched first. */
const WORDS: [RoomKind, string[]][] = [
  ["meeting_room", ["meeting rooms", "meeting room", "conference room", "boardroom", "board room"]],
  ["private_office", ["private offices", "private office"]],
  [
    "open_workspace",
    ["open workspace", "open plan", "open-plan", "workspace", "desk area", "desks", "work area"],
  ],
  ["server_room", ["server room", "server closet", "comms room", "it room"]],
  ["reception", ["reception", "front desk"]],
  ["kitchen", ["kitchenette", "kitchen", "pantry"]],
  ["lounge", ["breakout area", "break out area", "lounge"]],
  ["storage", ["storeroom", "store room", "supply room", "storage"]],
  ["restroom", ["restrooms", "restroom", "bathroom", "washroom", "toilets", "toilet", "loo", "wc"]],
];

const ORDINALS: Record<string, number> = {
  first: 1,
  "1st": 1,
  second: 2,
  "2nd": 2,
  third: 3,
  "3rd": 3,
  fourth: 4,
  "4th": 4,
  fifth: 5,
  "5th": 5,
  last: -1,
};

export type Resolved = { ok: true; id: string } | { ok: false; reason: string };

const clean = (text: string) =>
  text
    .toLowerCase()
    .replace(/\b(the|a|an|my|our|that|this)\b/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Find the room a phrase means in a plan: an exact id ("kitchen.1"), the room's own name, or a
 * kind with an optional number ("meeting room 2", "second meeting room"). A phrase that fits
 * several rooms is refused with the choices, never guessed.
 */
export function resolveRoom(plan: Pick<FloorPlan, "rooms">, phrase: string): Resolved {
  const text = clean(phrase);
  if (!text) return { ok: false, reason: "No room was named." };
  const byId = plan.rooms.find((r) => r.id === text.replace(/\s/g, ""));
  if (byId) return { ok: true, id: byId.id };
  const byName = plan.rooms.filter((r) => clean(r.name) === text);
  if (byName.length === 1) return { ok: true, id: (byName[0] as { id: string }).id };

  let ordinal: number | undefined;
  let rest = text;
  for (const [word, n] of Object.entries(ORDINALS))
    if (new RegExp(`(^|\\s)${word}(\\s|$)`).test(rest)) {
      ordinal = n;
      rest = rest.replace(new RegExp(`(^|\\s)${word}(?=\\s|$)`), " ").trim();
    }
  const digit = rest.match(/\s(\d{1,2})$/);
  if (digit) {
    ordinal = Number(digit[1]);
    rest = rest.slice(0, digit.index).trim();
  }
  const kind = WORDS.find(([, words]) => words.some((w) => rest === w))?.[0];
  if (!kind)
    return { ok: false, reason: `There is no room called “${phrase.trim()}” in this plan.` };
  const rooms = plan.rooms.filter((r) => r.kind === kind);
  if (rooms.length === 0) return { ok: false, reason: `This plan has no ${rest}.` };
  if (ordinal !== undefined) {
    const found = rooms[ordinal === -1 ? rooms.length - 1 : ordinal - 1];
    return found
      ? { ok: true, id: found.id }
      : {
          ok: false,
          reason: `This plan has only ${rooms.length} ${rest}${rooms.length > 1 ? "s" : ""}.`,
        };
  }
  if (rooms.length === 1) return { ok: true, id: (rooms[0] as { id: string }).id };
  return {
    ok: false,
    reason: `There are ${rooms.length} ${rest}s (${rooms.map((r) => r.name).join(", ")}); say which one.`,
  };
}

/** True when the phrase names a kind of room at all, even one this plan lacks. */
export const mentionsRoom = (phrase: string) => {
  const text = clean(phrase).replace(/\s\d{1,2}$/, "");
  const words = text.split(" ").filter((w) => !(w in ORDINALS));
  const joined = words.join(" ");
  return WORDS.some(([, list]) => list.includes(joined));
};
