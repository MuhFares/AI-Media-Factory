/**
 * LLM execution contracts (provider-agnostic).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { ExecutionContext } from "./context.js";
import type { Json } from "./common.js";
import type { PromptCompiler, PromptContext, FinalPrompt } from "../types/prompt-compiler.js";

/** A uniform, vendor-neutral request to run a model. */
export interface ExecutionRequest {
  model: string;
  system: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature: number;
  maxOutputTokens: number;
  /** The output schema the model is asked to conform to. */
  responseSchema?: import("./validation.js").JsonSchema;
}

/** Token/cost usage returned by a provider. */
export interface Usage {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

/** A uniform, vendor-neutral response. */
export interface ExecutionResponse {
  output: Json;
  raw: string;
  usage: Usage;
  model: string;
  provider: string;
  latencyMs: number;
}

/**
 * Builds the ExecutionRequest from context + input, drives the selected
 * provider, and returns a normalized response. Knows nothing about which
 * vendor runs — that is the ProviderRegistry's job.
 *
 * Uses the PromptCompiler to assemble the final prompt from context.
 */
export interface LlmExecutor {
  buildRequest(context: ExecutionContext): ExecutionRequest;
  execute(request: ExecutionRequest, signal: import("./resilience.js").CancellationToken): Promise<ExecutionResponse>;
}

/**
 * Compiles the execution context into a final prompt using the PromptCompiler.
 * The Runtime calls this before sending to the Provider Layer.
 */
export interface PromptAssembler {
  /** Assemble the final prompt from execution context. */
  assemblePrompt(context: ExecutionContext): Promise<FinalPrompt>;
}
