import { type FloorPlan, type Program, ProgramSchema } from "@icarus/core";
import { fromFloorPlan, SpatialModel, upgradeSaved } from "@icarus/spatial/model";
import type { Message } from "./Studio";

export interface SavedRevision {
  program: Program;
  plan: FloorPlan;
  seed: number;
  notes: string[];
}

export interface SavedBuild {
  id: string;
  title: string;
  brief: string;
  program: Program;
  plan: FloorPlan;
  seed: number;
  notes: string[];
  editedAt: number;
  /** 2 once the spatial model is attached. Saves from before it have neither field. */
  version?: number;
  /**
   * The building as the spatial model sees it, derived from `plan` every time a build is loaded or
   * saved so it can never be stale. The plan is still what the app reads; the model is carried so
   * a saved office is already in the format later features will use.
   */
  model?: SpatialModel;
  conversation?: Message[];
  history?: SavedRevision[];
}

export interface SavedDrawing {
  id: string;
  title: string;
  model: SpatialModel;
  editedAt: number;
  conversation: Message[];
}

function messages(value: unknown): Message[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (m): m is Message =>
      !!m &&
      typeof m === "object" &&
      typeof m.id === "string" &&
      (m.role === "you" || m.role === "icarus") &&
      typeof m.text === "string" &&
      !m.working,
  );
}

/** Derive the spatial model from the plan, even if an older save carried a stale model. */
function modelOf(b: SavedBuild): SavedBuild {
  const { version: _version, model: _model, ...rest } = b;
  return upgradeSaved(rest, b.title);
}

/** Saving an in-memory build keeps its original payload if conversion fails. */
function withModel(b: SavedBuild): SavedBuild {
  try {
    return modelOf(b);
  } catch {
    return b;
  }
}

const KEY = "icarus.builds.v1";

export function loadBuilds(): SavedBuild[] {
  try {
    const raw = localStorage.getItem(KEY);
    const all: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(all)) return [];
    // Re-validate each program so a build saved before a field existed (locks, arrangement) gets its
    // defaults instead of breaking the page; one that no longer parses is dropped.
    return all.flatMap((b: unknown) => {
      if (!b || typeof b !== "object") return [];
      const entry = b as SavedBuild;
      if (
        typeof entry.id !== "string" ||
        typeof entry.title !== "string" ||
        typeof entry.brief !== "string" ||
        !entry.plan ||
        typeof entry.plan !== "object" ||
        typeof entry.seed !== "number"
      )
        return [];
      const program = ProgramSchema.safeParse(entry.program);
      if (!program.success) return [];
      const candidate = {
        ...entry,
        program: program.data,
        conversation: messages(entry.conversation),
        history: Array.isArray(entry.history)
          ? entry.history.flatMap((h) => {
              if (!h || typeof h !== "object") return [];
              const parsed = ProgramSchema.safeParse(h.program);
              if (!parsed.success || !h.plan || typeof h.seed !== "number") return [];
              try {
                fromFloorPlan(h.plan, { program: parsed.data });
                return [{ ...h, program: parsed.data }];
              } catch {
                return [];
              }
            })
          : [],
      };
      try {
        return [modelOf(candidate)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

export function saveBuilds(builds: SavedBuild[]) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify(
        builds.slice(0, 24).map((b) =>
          withModel({
            ...b,
            conversation: messages(b.conversation),
            history: b.history?.slice(-20),
          }),
        ),
      ),
    );
  } catch {
    // Storage can be blocked or full; the app works without it.
  }
}

const DRAWINGS_KEY = "icarus.drawings.v1";

export function loadDrawings(): SavedDrawing[] {
  try {
    const raw = localStorage.getItem(DRAWINGS_KEY);
    const all: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(all)) return [];
    return all.flatMap((d) => {
      if (!d || typeof d !== "object") return [];
      const entry = d as Record<string, unknown>;
      const model = SpatialModel.safeParse(entry.model);
      return model.success && typeof entry.id === "string" && typeof entry.title === "string"
        ? [
            {
              id: entry.id,
              title: entry.title,
              model: model.data,
              editedAt: typeof entry.editedAt === "number" ? entry.editedAt : 0,
              conversation: messages(entry.conversation),
            },
          ]
        : [];
    });
  } catch {
    return [];
  }
}

export function saveDrawings(drawings: SavedDrawing[]) {
  try {
    localStorage.setItem(
      DRAWINGS_KEY,
      JSON.stringify(
        drawings.slice(0, 24).map((d) => ({ ...d, conversation: messages(d.conversation) })),
      ),
    );
  } catch {
    // The current session still works when local storage is unavailable.
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
