/**
 * The PromptCompiler — single entry point for prompt assembly.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * This is the single entry point. The Runtime calls assemble() with a
 * PromptContext and receives a FinalPrompt ready for the Provider Layer.
 */

import type { AgentId, Json, Uuid } from "./common";
import type { PromptContext } from "./context";
import type { FinalPrompt } from "./builder";

export interface PromptCompiler {
  /**
   * Assemble the final prompt from all inputs.
   * This is a pure function: same PromptContext → same FinalPrompt.
   */
  assemble(context: PromptContext): Promise<FinalPrompt>;

  /** Compile without caching (for testing/debugging). */
  assembleUncached(context: PromptContext): Promise<FinalPrompt>;

  /** Invalidate cache entries for an agent (e.g. on template/schema change). */
  invalidateCache(agent: AgentId): Promise<void>;
}