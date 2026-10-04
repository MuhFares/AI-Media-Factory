/**
 * Prompt Versioning (Req #15).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Semantic versioning for prompt templates with content hashing for cache invalidation.
 */

export interface VersionPolicy {
  /** When to bump major. */
  majorTriggers: string[];
  /** When to bump minor. */
  minorTriggers: string[];
  /** Auto-bump patch on any change. */
  autoPatch: boolean;
}
