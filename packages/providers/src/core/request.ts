/**
 * The unified vendor-neutral request/response contracts.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * These types are owned by the provider layer (not the runtime), so this
 * package never imports from the runtime. The runtime maps its ExecutionRequest
 * onto GenerateRequest.
 */

import type { Capability } from "./capabilities.js";
import type { Json, ModelId } from "./common.js";

/** A part of a message — text or image (vision, req #14). */
export type ContentPart =
  | { kind: "text"; text: string }
  | { kind: "image"; url: string; mime?: string };

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: ContentPart[];
}

/** A callable tool/function definition (function calling, req #13). */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Json; // JSON Schema for the tool arguments
}

/** Structured-output request (JSON mode, req #12). */
export interface ResponseFormat {
  kind: "text" | "json" | "json_schema";
  schema?: Json; // JSON Schema when kind === "json_schema"
}

/** The single vendor-neutral request the runtime hands to generate()/stream(). */
export interface GenerateRequest {
  /** Logical tier or explicit model id; the router resolves logical tiers. */
  model: ModelId;
  messages: Message[];
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: ResponseFormat;
  tools?: ToolDef[];
  stream?: boolean;
  /** Capabilities this request requires; drives routing capability filter. */
  requires?: Capability[];
}

/** Token usage + resolved cost for one call (reqs #18, #19). */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** A tool call the model requested. */
export interface ToolCall {
  name: string;
  arguments: Json;
}

export interface GenerateResponse {
  /** Parsed structured output when a schema/json format was requested, else text. */
  output: Json;
  text: string;
  toolCalls?: ToolCall[];
  usage: Usage;
  provider: string;
  model: ModelId;
  latencyMs: number;
  finishReason: "stop" | "length" | "tool_calls" | "content_filter" | "error";
}

/** One streamed increment (streaming, req #11). */
export interface StreamChunk {
  delta: string;
  done: boolean;
  usage?: Usage; // present on the final chunk
}

/** Embedding request/response (req #15). */
export interface EmbeddingRequest {
  model: ModelId;
  input: string[];
}

export interface EmbeddingResponse {
  vectors: number[][];
  usage: Usage;
  provider: string;
  model: ModelId;
}
