import { z } from "zod";
import { MetaError } from "./errors";
import type { RespondRequest, RespondResult, ToolCall } from "./types";
import { DEFAULT_MODEL } from "./types";

/** JSON Schema for a zod type, without the `$schema` marker the API does not need. */
export function jsonSchema(type: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(type) as Record<string, unknown>;
  return rest;
}

export function buildRespondBody<T>(request: RespondRequest<T>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model ?? DEFAULT_MODEL,
    input: request.input,
  };
  if (request.instructions) body.instructions = request.instructions;
  if (request.previousResponseId) body.previous_response_id = request.previousResponseId;
  if (request.maxOutputTokens) body.max_output_tokens = request.maxOutputTokens;
  if (request.reasoningEffort) body.reasoning = { effort: request.reasoningEffort };
  if (request.schema)
    body.text = {
      format: {
        type: "json_schema",
        name: request.schema.name,
        schema: jsonSchema(request.schema.type),
      },
    };
  if (request.tools?.length)
    body.tools = request.tools.map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: jsonSchema(tool.parameters),
    }));
  return body;
}

const OutputItem = z.looseObject({ type: z.string() });
const ResponseBody = z.looseObject({
  id: z.string(),
  status: z.string().optional(),
  output: z.array(OutputItem).default([]),
  incomplete_details: z.looseObject({ reason: z.string().optional() }).nullish(),
  error: z.looseObject({ message: z.string().optional() }).nullish(),
  usage: z
    .looseObject({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
    .optional(),
});

const MessageItem = z.looseObject({
  type: z.literal("message"),
  content: z.array(z.looseObject({ type: z.string(), text: z.string().optional() })).default([]),
});
const FunctionCall = z.looseObject({
  type: z.literal("function_call"),
  name: z.string(),
  arguments: z.string(),
  call_id: z.string(),
});

/** Read a Responses API body into text and tool calls, refusing anything malformed or incomplete. */
export function readResponse(raw: unknown): Omit<RespondResult, "parsed"> {
  const parsed = ResponseBody.safeParse(raw);
  if (!parsed.success)
    throw new MetaError("invalid_response", "response did not look like a Responses API body");
  const body = parsed.data;
  if (body.status === "failed")
    throw new MetaError("server", `response failed: ${body.error?.message ?? "unknown"}`, {
      retryable: true,
    });
  if (body.status === "incomplete")
    throw new MetaError(
      "invalid_response",
      `response was incomplete (${body.incomplete_details?.reason ?? "unknown reason"})`,
    );
  let text = "";
  const toolCalls: ToolCall[] = [];
  for (const item of body.output) {
    const message = MessageItem.safeParse(item);
    if (message.success) {
      for (const part of message.data.content)
        if (part.type === "output_text" && part.text) text += part.text;
      continue;
    }
    const call = FunctionCall.safeParse(item);
    if (call.success)
      toolCalls.push({
        callId: call.data.call_id,
        name: call.data.name,
        arguments: call.data.arguments,
      });
  }
  return {
    id: body.id,
    text,
    toolCalls,
    usage: {
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
    },
  };
}

/**
 * Pull one JSON value out of model text. Models asked for "JSON only" still sometimes add a code
 * fence or a sentence around it; take the first balanced object and let the schema judge it.
 */
export function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return trimmed;
    } catch {
      // fall through to the scan below
    }
  }
  const start = trimmed.search(/[{[]/);
  if (start < 0) return trimmed;
  let depth = 0;
  let inString = false;
  for (let i = start; i < trimmed.length; i++) {
    const c = trimmed[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) return trimmed.slice(start, i + 1);
    }
  }
  return trimmed;
}

/** Parse constrained output and validate it again here: decoding is guided, not a guarantee. */
export function validateStructured<T>(
  text: string,
  schema: { name: string; type: z.ZodType<T> },
): T {
  let json: unknown;
  try {
    json = JSON.parse(extractJson(text));
  } catch {
    throw new MetaError("invalid_response", `${schema.name}: model output was not JSON`);
  }
  const result = schema.type.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 3)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
    throw new MetaError(
      "invalid_response",
      `${schema.name}: output failed validation (${issues.join("; ")})`,
    );
  }
  return result.data;
}
