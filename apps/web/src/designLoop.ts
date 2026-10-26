import {
  type Advisor,
  evaluateProgram,
  type Issue,
  type Merged,
  mergeProposal,
  type Patch,
  PatchSchema,
  type Program,
  type Proposal,
  ProposalSchema,
  type RefineResult,
  type Round,
  readBrief,
  refineDesign,
} from "@icarus/core";

type Fetch = typeof fetch;

/** What the model contributed to a design, shown to the user so nothing it did is hidden. */
export interface ModelTrace {
  /** "model" when a proposal was merged, "rules" when none was available. */
  proposal: "model" | "rules";
  model?: string;
  decisions: (Merged["decisions"][number] & { used: boolean })[];
  /** What the model asked for and was refused because the brief states it. */
  ignored: string[];
  /** What the model proposed that measured worse than not doing it, and so was not used. */
  vetoed: string[];
  /** Why the model did not take part, in plain words. */
  note?: string;
  /** How many revisions the model suggested, and how many measured as improvements. */
  revisions: { asked: number; valid: number; used: number };
}

export interface DesignOutcome {
  program: Program;
  refine: RefineResult;
  trace: ModelTrace;
  notes: string[];
}

async function post<T>(
  fetcher: Fetch,
  path: string,
  body: unknown,
  parse: (raw: unknown) => T | undefined,
): Promise<{ value?: T; model?: string; error?: string; down?: boolean }> {
  let res: Response;
  try {
    res = await fetcher(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { error: "the model service is not reachable", down: true };
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    return {
      error: typeof data.error === "string" ? data.error : "the model service failed",
      down: res.status === 503 || res.status === 404,
    };
  const value = parse(data.proposal ?? data.patch);
  return value === undefined
    ? { error: "the model's answer was not usable" }
    : { value, model: typeof data.model === "string" ? data.model : undefined };
}

/** The model as an advisor: it sees measured issues and answers with a patch. Never trusted without the solver's measurement. */
export function remoteAdvisor(fetcher: Fetch, counts: ModelTrace["revisions"]): Advisor {
  return {
    async revise({ program, issues, round }: { program: Program; issues: Issue[]; round: number }) {
      counts.asked++;
      const result = await post<Patch>(
        fetcher,
        "/api/design/revise",
        { program, issues, round },
        (raw) => {
          const parsed = PatchSchema.safeParse(raw);
          return parsed.success ? parsed.data : undefined;
        },
      );
      if (result.value) counts.valid++;
      return result.value;
    },
  };
}

/** Plan, measure and repair a program that is already decided (the photo path, or after a merge). */
export async function refineProgram(
  program: Program,
  notes: string[],
  options: {
    onRound?: (round: Round) => void;
    yieldToHost?: () => Promise<void>;
    advisor?: Advisor;
  } = {},
): Promise<DesignOutcome> {
  const trace: ModelTrace = {
    proposal: "rules",
    decisions: [],
    ignored: [],
    vetoed: [],
    revisions: { asked: 0, valid: 0, used: 0 },
  };
  const refine = await refineDesign(program, {
    advisor: options.advisor,
    onRound: options.onRound,
    yieldToHost: options.yieldToHost,
  });
  return { program: refine.best.program, refine, trace, notes };
}

/**
 * Design an office from a brief: read the stated facts, ask the model what the brief left open,
 * merge its answer without letting it override anything stated, then plan, measure and repair.
 * Every network call can fail and the design still completes with the rules alone.
 */
export async function designFromBrief(
  brief: string,
  options: {
    fetcher?: Fetch;
    useModel?: boolean;
    onStage?: (stage: string) => void;
    onRound?: (round: Round) => void;
    yieldToHost?: () => Promise<void>;
  } = {},
): Promise<DesignOutcome> {
  const fetcher = options.fetcher ?? fetch.bind(globalThis);
  const read = readBrief(brief);
  const trace: ModelTrace = {
    proposal: "rules",
    decisions: [],
    ignored: [],
    vetoed: [],
    revisions: { asked: 0, valid: 0, used: 0 },
  };
  let program = read.program;
  let notes = read.notes;
  let serviceDown = false;

  if (options.useModel !== false) {
    options.onStage?.("Asking the model what this office needs");
    const result = await post<Proposal>(fetcher, "/api/design/propose", { brief }, (raw) => {
      const parsed = ProposalSchema.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    });
    if (result.value) {
      const merged = mergeProposal(read, result.value);
      // The model proposes and the measurement decides: use its additions only if the plan does not get worse.
      options.onStage?.("Checking the model's proposal against the plan");
      await options.yieldToHost?.();
      const seeds = [1, 2];
      const rulesOnly = evaluateProgram(read.program, { seeds });
      const withModel = evaluateProgram(merged.program, { seeds });
      let chosen = merged.program;
      const added = merged.program.rooms
        .filter((r) => !read.program.rooms.some((o) => o.kind === r.kind))
        .map((r) => r.kind);
      if (withModel.cost > rulesOnly.cost + 0.5) {
        const trimmedProgram = {
          ...merged.program,
          rooms: merged.program.rooms.filter((r) => !added.includes(r.kind)),
        };
        const trimmed = added.length ? evaluateProgram(trimmedProgram, { seeds }) : undefined;
        if (trimmed && trimmed.cost <= rulesOnly.cost + 0.5) {
          chosen = trimmedProgram;
          trace.vetoed.push(
            `Not added: ${added.map((k) => k.replace(/_/g, " ")).join(", ")}. The plan measured worse with ${added.length === 1 ? "it" : "them"} (score ${withModel.cost.toFixed(1)} against ${trimmed.cost.toFixed(1)}).`,
          );
        } else {
          chosen = { ...read.program, preferences: merged.program.preferences };
          trace.vetoed.push(
            `Set aside the model's room changes: the plan measured worse with them (score ${withModel.cost.toFixed(1)} against ${rulesOnly.cost.toFixed(1)}). Its neighbour wishes were kept.`,
          );
        }
      }
      program = chosen;
      // A decision about a room that was set aside is shown, but as not used and not recorded as an assumption.
      const droppedKinds = added.filter((k) => !chosen.rooms.some((r) => r.kind === k));
      const decisions = merged.decisions.map((d) => ({
        ...d,
        used: !droppedKinds.some((k) =>
          `${d.topic} ${d.choice}`.toLowerCase().includes(k.replace(/_/g, " ")),
        ),
      }));
      notes = [
        ...read.notes,
        ...decisions.filter((d) => d.used).map((d) => `${d.topic}: ${d.choice}. ${d.reason}`),
      ];
      trace.proposal = "model";
      trace.model = result.model;
      trace.decisions = decisions;
      trace.ignored = merged.ignored;
    } else {
      serviceDown = !!result.down;
      trace.note = `${result.error ?? "no model answer"}; planned with the rules alone.`;
    }
  }

  options.onStage?.("Planning, checking and repairing");
  // A proposal that failed once (a free model can miss) does not stop revisions; an unreachable service does.
  const advisor =
    options.useModel === false || serviceDown ? undefined : remoteAdvisor(fetcher, trace.revisions);
  const refine = await refineDesign(program, {
    advisor,
    onRound: options.onRound,
    yieldToHost: options.yieldToHost,
  });
  trace.revisions.used = refine.rounds.filter((r) => r.source === "model" && r.accepted).length;
  return { program: refine.best.program, refine, trace, notes };
}
