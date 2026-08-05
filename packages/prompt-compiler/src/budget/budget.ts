/**
 * Token Budgeting (Req #5).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Manages token budget allocation across sections, enforces limits,
 * and handles trimming when over budget.
 */

import type { SectionType } from "./common";

export interface TokenBudget {
  total: number;                    // Model context window (e.g. 128000)
  reservedForCompletion: number;    // Min tokens reserved for model output (e.g. 25000)
  maxPromptTokens: number;          // total - reservedForCompletion
  allocations: SectionAllocation[];
}

export interface SectionAllocation {
  section: SectionType;
  maxTokens: number;                // Hard ceiling
  priority: number;                 // Higher = protected from trimming
  flexible: boolean;                // Can be trimmed if over budget
}

/** Allocates tokens to sections based on % allocations and priority. */
export interface BudgetAllocator {
  /** Compute per-section token ceilings from a TokenBudget. */
  allocate(budget: TokenBudget): SectionAllocation[];

  /** Trim a prompt to fit within maxPromptTokens.
   *  Returns trimmed sections and a flag indicating if trimming occurred. */
  trimToBudget(
    sections: Map<string, { content: string; tokens: number }>,
    allocations: SectionAllocation[],
    maxTokens: number
  ): { sections: Map<string, { content: string; tokens: number }>; trimmed: boolean };

  /** Estimate tokens for a string (using model's tokenizer). */
  estimateTokens(text: string, model?: string): number;
}