import {
  IssueSchema,
  PatchSchema,
  ProgramSchema,
  ProposalSchema,
  proposeInput,
  proposeInstructions,
  readBrief,
  reviseInput,
  reviseInstructions,
} from "@icarus/core";
import { type MetaApi, MetaError, metaClientFromEnv } from "@icarus/meta";
import { z } from "zod";
import type { AiBinding } from "./render";
import { FallbackMeta, WORKERS_AI_MODEL, WorkersAiMeta } from "./workersAi";

/** Where the model comes from, kept behind an interface so tests use a scripted fake. */
export type ModelSource = () => { api: MetaApi; model: () => string } | undefined;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/**
 * The free model used for design calls until Muse Spark credits exist. Chosen by testing ten free
 * models on this task: it answered validly in about 9 s without a reasoning dump, where others
 * were rate limited or ran out of tokens thinking. Override with ICARUS_MODEL.
 */
export const DESIGN_DEV_MODEL = "poolside/laguna-s-2.1:free";

/** The model service from the Worker's environment, or undefined when no key is configured. */
export function modelFromEnv(env: Record<string, unknown>): ModelSource {
  return () => {
    const strings = Object.fromEntries(
      Object.entries(env).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
    const ai = (env.AI as AiBinding | undefined)?.run ? (env.AI as AiBinding) : undefined;
    const workers = ai ? { api: new WorkersAiMeta(ai), model: WORKERS_AI_MODEL } : undefined;
    const hasKey = !!(strings.OPENROUTER_API_KEY?.trim() || strings.MODEL_API_KEY?.trim());
    if (!hasKey) return workers ? { api: workers.api, model: () => workers.model } : undefined;
    const withModel = strings.OPENROUTER_API_KEY?.trim()
      ? { ...strings, ICARUS_MODEL: strings.ICARUS_MODEL || DESIGN_DEV_MODEL }
      : strings;
    const client = metaClientFromEnv(withModel, { timeoutMs: 60_000, maxRetries: 2 });
    const primary = { api: client as MetaApi, model: client.model };
    if (!workers) return { api: primary.api, model: () => primary.model };
    // A second free route, tried when the first is busy, down or out of allowance.
    const both = new FallbackMeta(primary, workers);
    return { api: both, model: () => both.lastModel };
  };
}

/** Ask once more when the model's answer did not match the schema: free models vary, and the second try often works. */
async function twice<T>(attempt: () => Promise<T>): Promise<T> {
  try {
    return await attempt();
  } catch (error) {
    if (error instanceof MetaError && error.category === "invalid_response") return attempt();
    throw error;
  }
}

/** Map a model-service failure to a status the browser can act on, without leaking internals. */
function failure(error: unknown): Response {
  // Logged for the developer in the Worker's own log; the browser only gets a plain sentence.
  if (error instanceof MetaError)
    console.error(
      `[design] model error: ${error.category} ${error.status ?? ""} ${error.message.slice(0, 240)}`,
    );
  else console.error("[design] model error: unexpected");
  if (error instanceof MetaError) {
    if (error.category === "rate_limited")
      return json({ error: "the model service is busy; try again shortly" }, 429);
    if (error.category === "auth")
      return json({ error: "the model service is not configured correctly" }, 503);
    if (error.category === "invalid_response")
      return json({ error: "the model's answer did not match what Icarus needs" }, 502);
  }
  return json({ error: "the model could not be reached" }, 502);
}

async function body<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T> | Response> {
  if (request.method !== "POST") return json({ error: "method not allowed" }, 405);
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "body must be JSON" }, 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return json(
      {
        error: "invalid request",
        issues: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`),
      },
      400,
    );
  return parsed.data;
}

const ProposeBody = z.object({ brief: z.string().min(8).max(1500) });
const ReviseBody = z.object({
  program: ProgramSchema,
  issues: z.array(IssueSchema).max(40),
  round: z.int().min(1).max(6),
});

/** POST /api/design/propose: the model suggests what the brief left open. */
export async function handlePropose(request: Request, source: ModelSource): Promise<Response> {
  const input = await body(request, ProposeBody);
  if (input instanceof Response) return input;
  const model = source();
  if (!model) return json({ error: "no model is configured" }, 503);
  try {
    const result = await twice(() =>
      model.api.respond({
        instructions: proposeInstructions(),
        input: proposeInput(input.brief, readBrief(input.brief)),
        schema: { name: "Proposal", type: ProposalSchema },
        maxOutputTokens: 3000,
        reasoningEffort: "low",
      }),
    );
    return json({ proposal: result.parsed, model: model.model() });
  } catch (error) {
    return failure(error);
  }
}

/** POST /api/design/revise: the model sees measured problems and proposes a patch. */
export async function handleRevise(request: Request, source: ModelSource): Promise<Response> {
  const input = await body(request, ReviseBody);
  if (input instanceof Response) return input;
  const model = source();
  if (!model) return json({ error: "no model is configured" }, 503);
  try {
    const result = await twice(() =>
      model.api.respond({
        instructions: reviseInstructions(),
        input: reviseInput(input.program, input.issues, input.round),
        schema: { name: "Patch", type: PatchSchema },
        maxOutputTokens: 2500,
        reasoningEffort: "low",
      }),
    );
    return json({ patch: result.parsed, model: model.model() });
  } catch (error) {
    return failure(error);
  }
}
