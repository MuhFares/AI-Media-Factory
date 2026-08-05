/**
 * Loader contracts: turn an agent's on-disk data into typed runtime inputs.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Loaders are the reason the runtime is generic: they read the SAME shape of
 * data for every agent (config.yaml, prompts/*, memory/*, schemas/*).
 */

import type { AgentId, Json } from "./common.js";
import type { JsonSchema } from "./validation.js";

/** Parsed, typed view of an agent's config.yaml. */
export interface AgentConfig {
  schema_version: string;
  agent: { id: AgentId; name: string; layer: string; version: string };
  model: {
    primary: string;
    fallback?: string;
    temperature: number;
    max_output_tokens: number;
    routing_ref?: string;
  };
  tools: { allow: string[]; deny: string[] };
  budgets: Record<string, number | string>;
  guardrails: Record<string, boolean | string>;
  escalation: { to: string | string[]; triggers: string[]; timeout_seconds: number };
  memory: { long_term_ref: string; short_term_ref: string };
  io: { input_schema: string; output_schema: string };
}

/** Resolved prompt set for an agent. */
export interface PromptSet {
  system: string;
  instructions: string;
  examples: string;
}

/** The input and output JSON Schemas for an agent. */
export interface AgentSchemas {
  input: JsonSchema;
  output: JsonSchema;
}

export interface ConfigLoader {
  load(agent: AgentId): Promise<AgentConfig>;
}

export interface PromptLoader {
  load(agent: AgentId): Promise<PromptSet>;
}

export interface SchemaLoader {
  load(agent: AgentId): Promise<AgentSchemas>;
}

/** Loads memory needed to start a turn (retrieval is defined in memory.ts). */
export interface MemoryLoader {
  loadForTurn(agent: AgentId, query: Json): Promise<import("./memory.js").LoadedMemory>;
}
