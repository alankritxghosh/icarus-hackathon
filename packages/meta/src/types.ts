import type { z } from "zod";

export const DEFAULT_MODEL = "muse-spark-1.3";
export const SAM_MODEL = "sam-3.1";

export type InputContent =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string }
  | { type: "output_text"; text: string };

export type InputItem =
  | { type: "message"; role: "user" | "developer" | "assistant"; content: InputContent[] }
  | { type: "function_call_output"; call_id: string; output: string };

export interface RespondRequest<T = never> {
  model?: string;
  instructions?: string;
  input: string | InputItem[];
  /** When set, decoding is constrained to this schema and the output is validated against it. */
  schema?: { name: string; type: z.ZodType<T> };
  tools?: { name: string; description: string; parameters: z.ZodType }[];
  previousResponseId?: string;
  maxOutputTokens?: number;
}

export interface ToolCall {
  callId: string;
  name: string;
  /** Raw JSON text exactly as the model produced it. Validate before use. */
  arguments: string;
}

export interface RespondResult<T = never> {
  id: string;
  text: string;
  parsed: T | undefined;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number };
}

export interface SamMatch {
  frame: number;
  id: number;
  /** Source pixels. */
  box: { x1: number; y1: number; x2: number; y2: number; w: number; h: number };
  confidence?: number;
  /** Still base85-encoded; decoding is added when the segmentation stage needs pixel masks. */
  mask: { rows: number; cols: number; encoding: "lossless" | "one_bit"; payload: string };
}

/** What the rest of Icarus depends on. The real client and the deterministic fake both implement it. */
export interface MetaApi {
  respond<T = never>(request: RespondRequest<T>): Promise<RespondResult<T>>;
  segment(request: { image: string; phrase: string }): Promise<SamMatch[]>;
}
