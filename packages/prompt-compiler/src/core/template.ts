/**
 * PromptTemplate and versioning (req #15).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { PromptVersion, SectionType } from "../core/common";

/**
 * A versioned prompt template. The template defines the structure and
 * static parts of a prompt; dynamic parts are injected at compile time.
 */
export interface PromptTemplate {
  agent: AgentId;
  version: PromptVersion;
  /** Template string with placeholders like {{system}}, {{company_brain}}, etc. */
  template: string;
  /** Which sections are required (cannot be empty/omitted). */
  requiredSections: SectionType[];
  /** Per-section token budgets. */
  sectionBudgets: Record<SectionType, number>;
  /** Template hash for cache invalidation. */
  hash: string;
  createdAt: Timestamp;
  createdBy: string;
}

export interface PromptVersion {
  major: number;      // Breaking: section order, required sections, schema changes
  minor: number;      // Additive: new optional sections, template improvements
  patch: number;      // Bug fixes: typo fixes, token optimization
  hash: string;       // Content hash for cache invalidation
}

export interface VersionRegistry {
  register(template: PromptTemplate): PromptVersion;
  resolve(agent: AgentId, version: PromptVersion): PromptTemplate;
  latest(agent: AgentId): PromptTemplate;
}