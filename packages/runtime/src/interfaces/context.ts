/**
 * Execution context: the immutable bundle one agent turn runs against.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { AgentConfig, AgentSchemas, PromptSet } from "./loaders.js";
import type { LoadedMemory } from "./memory.js";
import type { RuntimeEvent } from "./events.js";
import type { Uuid } from "./common.js";

/** Everything an agent turn needs, assembled once and treated as immutable. */
export interface ExecutionContext {
  readonly turnId: Uuid;
  readonly config: AgentConfig;
  readonly prompts: PromptSet;
  readonly schemas: AgentSchemas;
  readonly memory: LoadedMemory;
  readonly inputEvent: RuntimeEvent;
  /** Remaining budget for this turn, derived from config.budgets. */
  readonly budgetCeilingUsd: number;
  /** Per-turn deadline, derived from config.escalation.timeout_seconds. */
  readonly deadline: Date;
}

/** Assembles an ExecutionContext from the loaders + the input event. */
export interface ContextBuilder {
  build(input: {
    config: AgentConfig;
    prompts: PromptSet;
    schemas: AgentSchemas;
    memory: LoadedMemory;
    inputEvent: RuntimeEvent;
  }): Promise<ExecutionContext>;
}
