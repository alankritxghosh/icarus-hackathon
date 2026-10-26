import type { MetaError } from "./errors";
import { readResponse, validateStructured } from "./responses";
import type { MetaApi, RespondRequest, RespondResult, SamMatch } from "./types";

export type FakeStep =
  | { json: unknown }
  | { text: string }
  | { toolCalls: { name: string; arguments: unknown }[] }
  | { error: MetaError };

/**
 * A deterministic stand-in for the Meta Model API. Scripted answers go through the same
 * validation as real ones, so a test cannot pass by feeding the code output the real model could
 * never be held to. An unscripted call fails loudly instead of returning something plausible.
 */
export class FakeMeta implements MetaApi {
  readonly requests: RespondRequest<unknown>[] = [];
  readonly segmentRequests: { image: string; phrase: string }[] = [];
  private readonly steps: FakeStep[];
  private counter = 0;

  constructor(
    steps: FakeStep[] = [],
    private readonly segments: Record<string, SamMatch[]> = {},
  ) {
    this.steps = [...steps];
  }

  enqueue(...steps: FakeStep[]) {
    this.steps.push(...steps);
  }

  async respond<T = never>(request: RespondRequest<T>): Promise<RespondResult<T>> {
    this.requests.push(request as RespondRequest<unknown>);
    const step = this.steps.shift();
    if (!step) throw new Error("FakeMeta: unscripted respond() call");
    if ("error" in step) throw step.error;
    const id = `resp_fake_${++this.counter}`;
    const output: unknown[] = [];
    if ("json" in step) output.push(message(JSON.stringify(step.json)));
    else if ("text" in step) output.push(message(step.text));
    else
      for (const [i, call] of step.toolCalls.entries())
        output.push({
          type: "function_call",
          name: call.name,
          arguments: JSON.stringify(call.arguments),
          call_id: `call_${this.counter}_${i}`,
        });
    const result = readResponse({
      id,
      status: "completed",
      output,
      usage: { input_tokens: 0, output_tokens: 0 },
    });
    const parsed = request.schema ? validateStructured(result.text, request.schema) : undefined;
    return { ...result, parsed };
  }

  async segment(request: { image: string; phrase: string }): Promise<SamMatch[]> {
    this.segmentRequests.push(request);
    return this.segments[request.phrase] ?? [];
  }
}

const message = (text: string) => ({
  type: "message",
  role: "assistant",
  content: [{ type: "output_text", text }],
});
