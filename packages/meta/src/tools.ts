import type { z } from "zod";
import type { InputItem, MetaApi } from "./types";

export interface ToolSpec<A = unknown> {
  name: string;
  description: string;
  parameters: z.ZodType<A>;
  /** Runs only with validated arguments. A thrown error is reported back to the model, not hidden. */
  run(args: A): Promise<unknown> | unknown;
}

/** A tool with its argument type erased for storage in a list. Safe because arguments are validated before `run`. */
export type AnyTool = ToolSpec<unknown>;

/** Declare a tool with typed arguments; the schema guarantees `run` only sees values of that type. */
export function defineTool<A>(spec: ToolSpec<A>): AnyTool {
  return spec as unknown as AnyTool;
}

export interface ToolCallRecord {
  name: string;
  arguments: string;
  ok: boolean;
  /** The value returned to the model: the tool's result, or the reason the call was refused. */
  output: string;
}

export interface ToolLoopResult {
  text: string;
  calls: ToolCallRecord[];
  turns: number;
  stopped: "done" | "max_turns";
}

/**
 * A bounded tool-calling loop. Every argument set is validated against the tool's schema before
 * anything runs; a bad call is returned to the model as an error so it can correct itself. The
 * model proposes and the tools (and whatever validators they call) decide.
 */
export async function runToolLoop(
  api: MetaApi,
  options: {
    model?: string;
    instructions: string;
    input: string | InputItem[];
    tools: AnyTool[];
    maxTurns?: number;
  },
): Promise<ToolLoopResult> {
  const maxTurns = options.maxTurns ?? 6;
  const byName = new Map(options.tools.map((tool) => [tool.name, tool]));
  const calls: ToolCallRecord[] = [];
  let input = options.input;
  let previousResponseId: string | undefined;
  let text = "";
  for (let turn = 1; turn <= maxTurns; turn++) {
    const response = await api.respond({
      model: options.model,
      instructions: options.instructions,
      input,
      previousResponseId,
      tools: options.tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      })),
    });
    text = response.text;
    if (response.toolCalls.length === 0) return { text, calls, turns: turn, stopped: "done" };
    const outputs: InputItem[] = [];
    for (const call of response.toolCalls) {
      const record = await execute(byName.get(call.name), call.arguments);
      calls.push({ name: call.name, arguments: call.arguments, ...record });
      outputs.push({ type: "function_call_output", call_id: call.callId, output: record.output });
    }
    input = outputs;
    previousResponseId = response.id;
  }
  return { text, calls, turns: maxTurns, stopped: "max_turns" };
}

async function execute(
  tool: ToolSpec<unknown> | undefined,
  rawArguments: string,
): Promise<{ ok: boolean; output: string }> {
  if (!tool) return { ok: false, output: JSON.stringify({ error: "unknown tool" }) };
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawArguments);
  } catch {
    return { ok: false, output: JSON.stringify({ error: "arguments were not valid JSON" }) };
  }
  const checked = tool.parameters.safeParse(parsed);
  if (!checked.success) {
    const issues = checked.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    return {
      ok: false,
      output: JSON.stringify({ error: `invalid arguments: ${issues.join("; ")}` }),
    };
  }
  try {
    return { ok: true, output: JSON.stringify(await tool.run(checked.data)) ?? "null" };
  } catch (error) {
    return {
      ok: false,
      output: JSON.stringify({ error: error instanceof Error ? error.message : "tool failed" }),
    };
  }
}
