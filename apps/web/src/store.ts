import { type FloorPlan, type Program, ProgramSchema } from "@icarus/core";

export interface SavedBuild {
  id: string;
  title: string;
  brief: string;
  program: Program;
  plan: FloorPlan;
  seed: number;
  notes: string[];
  editedAt: number;
}

const KEY = "icarus.builds.v1";

export function loadBuilds(): SavedBuild[] {
  try {
    const raw = localStorage.getItem(KEY);
    const all = raw ? (JSON.parse(raw) as SavedBuild[]) : [];
    // Re-validate each program so a build saved before a field existed (locks, arrangement) gets its
    // defaults instead of breaking the page; one that no longer parses is dropped.
    return all.flatMap((b) => {
      const program = ProgramSchema.safeParse(b.program);
      return program.success ? [{ ...b, program: program.data }] : [];
    });
  } catch {
    return [];
  }
}

export function saveBuilds(builds: SavedBuild[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(builds.slice(0, 24)));
  } catch {
    // Storage can be blocked or full; the app works without it.
  }
}

export function ago(ms: number, now = Date.now()): string {
  const minutes = Math.round((now - ms) / 60000);
  if (minutes < 1) return "Edited just now";
  if (minutes < 60) return `Edited ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Edited ${hours} h ago`;
  return `Edited ${Math.round(hours / 24)} d ago`;
}
