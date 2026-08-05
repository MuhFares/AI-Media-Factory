/**
 * Prompt Versioning (Req #15).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Semantic versioning for prompt templates with content hashing for cache invalidation.
 */

export interface PromptVersion {
  major: number;      // Breaking: section order, required sections, schema changes
  minor: number;      // Additive: new optional sections, template improvements
  patch: number;      // Bug fixes: typo fixes, token optimization
  hash: string;       // Content hash for cache invalidation
}

export interface PromptTemplate {
  agent: string;
  version: PromptVersion;
  template: string;
  requiredSections: string[];
  sectionBudgets: Record<string, number>;
  hash: string;
  createdAt: string;
  createdBy: string;
}

export interface VersionRegistry {
  register(template: PromptTemplate): PromptVersion;
  resolve(agent: string, version: PromptVersion): PromptTemplate;
  latest(agent: string): PromptTemplate;
  /** List all versions for an agent. */
  list(agent: string): PromptVersion[];
}

export interface VersionPolicy {
  /** When to bump major. */
  majorTriggers: string[];
  /** When to bump minor. */
  minorTriggers: string[];
  /** Auto-bump patch on any change. */
  autoPatch: boolean;
}