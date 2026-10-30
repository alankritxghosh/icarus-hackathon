import { type AccountLesson, parseAccountLessons } from "@icarus/spatial/model";

// Without sign-in, "an account" is this browser. The lessons are small validated data (see packages/spatial/src/accountLessons.ts),
// kept in local storage under one key; a signed-in account would keep the same data in its own record.
const KEY = "icarus.lessons.v1";

export function loadLessons(
  storage: Pick<Storage, "getItem"> | undefined = safe(),
): AccountLesson[] {
  try {
    const raw = storage?.getItem(KEY);
    return raw ? parseAccountLessons(JSON.parse(raw)).lessons : [];
  } catch {
    return [];
  }
}

export function saveLessons(
  lessons: AccountLesson[],
  storage: Pick<Storage, "setItem"> | undefined = safe(),
): void {
  try {
    storage?.setItem(KEY, JSON.stringify({ version: 1, lessons }));
  } catch {
    // Storage full or blocked: the lessons still apply for this visit.
  }
}

function safe(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
