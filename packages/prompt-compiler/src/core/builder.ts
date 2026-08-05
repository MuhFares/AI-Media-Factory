/**
 * PromptBuilder — fluent API for constructing a FinalPrompt section by section.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * The PromptCompiler uses this internally. Exposed for testing/customization.
 */

import type { SectionType, Uuid } from "./common";
import type { PromptSection, FinalPrompt, PromptVersion, CacheKey } from "./builder";

export interface PromptBuilder {
  /** Start a new prompt assembly. */
  start(version: PromptVersion, budget: TokenBudget): PromptBuilder;

  /** Add a section (order is enforced by SectionType enum order). */
  addSection(section: PromptSection): PromptBuilder;

  /** Add multiple sections at once (order auto-enforced). */
  addSections(sections: PromptSection[]): PromptBuilder;

  /** Set the budget for this prompt. */
  withBudget(budget: TokenBudget): PromptBuilder;

  /** Set the template version. */
  withVersion(version: PromptVersion): PromptBuilder;

  /** Build and validate the final prompt. */
  build(): Promise<FinalPrompt>;
}

export interface TokenBudget {
  total: number;
  reservedForCompletion: number;
  maxPromptTokens: number;
  allocations: SectionAllocation[];
}

export interface SectionAllocation {
  section: SectionType;
  maxTokens: number;
  priority: number;
  flexible: boolean;
}