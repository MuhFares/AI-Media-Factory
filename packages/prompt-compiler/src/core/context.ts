/**
 * PromptContext — the complete input to the PromptCompiler.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * The Runtime assembles this from all sources and passes it to PromptCompiler.assemble().
 */

import type { AgentId, Json, JsonSchema, SectionType } from "./common.js";
import type { LoadedMemory } from "@ai-media-factory/memory-engine";
import type { WorkflowContext } from "@ai-media-factory/shared";
import type { GuardrailSet } from "../safety/safety.js";

/** Runtime-owned values consumed structurally at the prompt-compiler boundary. */
export interface PromptAgentConfig {
  readonly schema_version: string;
  readonly agent: { readonly id: string; readonly name: string; readonly layer: string; readonly version: string };
  readonly model: { readonly primary: string; readonly fallback?: string; readonly temperature: number; readonly max_output_tokens: number; readonly routing_ref?: string };
  readonly tools: { readonly allow: string[]; readonly deny: string[] };
  readonly budgets: Record<string, number | string>;
  readonly guardrails: Record<string, boolean | string>;
  readonly escalation: { readonly to: string | string[]; readonly triggers: string[]; readonly timeout_seconds: number };
  readonly memory: { readonly long_term_ref: string; readonly short_term_ref: string };
  readonly io: { readonly input_schema: string; readonly output_schema: string };
}

export interface PromptSet {
  readonly system: string;
  readonly instructions: string;
  readonly examples: string;
}

export interface PromptRuntimeEvent {
  readonly schema_version: "1.0.0";
  readonly event_id: string;
  readonly workflow_id: string;
  readonly correlation_id: string | null;
  readonly brand_id: string | null;
  readonly asset_id: string | null;
  readonly timestamp: string;
  readonly type: string;
  readonly source_agent: string;
  readonly target_agent: string;
  readonly payload: Json;
  readonly metadata: Record<string, Json | undefined>;
}

export interface PromptContext {
  /** The agent being executed. */
  agent: AgentId;
  /** The agent's static configuration (from config.yaml). */
  config: PromptAgentConfig;
  /** The agent's prompt files (system, instructions, examples). */
  prompts: PromptSet;
  /** Relevant memory retrieved by MemoryEngine.retrieve(). */
  memory: LoadedMemory;
  /** Workflow context passed by the Workflow Engine. */
  workflow: WorkflowContext;
  /** The input event that triggered this agent turn. */
  inputEvent: PromptRuntimeEvent;
  /** The agent's output schema (JSON Schema draft-07). */
  outputSchema: JsonSchema;
  /** Compiled safety rules from config + brand guidelines. */
  guardrails: GuardrailSet;
  /** Token budget for this prompt assembly. */
  budget: TokenBudget;
}

/** Token budget constraints for prompt assembly. */
export interface TokenBudget {
  total: number;                    // Model context window (e.g. 128000)
  reservedForCompletion: number;    // Minimum tokens reserved for model output
  maxPromptTokens: number;          // total - reservedForCompletion
  allocations: SectionAllocation[];
}

/** Per-section token allocation. */
export interface SectionAllocation {
  section: SectionType;
  maxTokens: number;                // Hard ceiling for this section
  priority: number;                 // Higher = protected from trimming (Safety=100)
  flexible: boolean;                // Can be trimmed if over budget
}
