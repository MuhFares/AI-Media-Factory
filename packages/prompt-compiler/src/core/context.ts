/**
 * PromptContext — the complete input to the PromptCompiler.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * The Runtime assembles this from all sources and passes it to PromptCompiler.assemble().
 */

import type { AgentId, Json, Timestamp, Uuid } from "./common";
import type { AgentConfig } from "../../runtime/src/interfaces/loaders";
import type { PromptSet } from "../../runtime/src/interfaces/loaders";
import type { LoadedMemory } from "../../memory-engine/src/core/record";
import type { WorkflowContext } from "../../workflow-engine/src/model/context";
import type { RuntimeEvent } from "../../runtime/src/interfaces/events";
import type { JsonSchema } from "../../prompt-compiler/src/core/validation";
import type { GuardrailSet } from "./safety";

export interface PromptContext {
  /** The agent being executed. */
  agent: AgentId;
  /** The agent's static configuration (from config.yaml). */
  config: AgentConfig;
  /** The agent's prompt files (system, instructions, examples). */
  prompts: PromptSet;
  /** Relevant memory retrieved by MemoryEngine.retrieve(). */
  memory: LoadedMemory;
  /** Workflow context passed by the Workflow Engine. */
  workflow: WorkflowContext;
  /** The input event that triggered this agent turn. */
  inputEvent: RuntimeEvent;
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