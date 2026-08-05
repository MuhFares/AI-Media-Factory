/**
 * Section types and the PromptSection data structure.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { SectionType } from "./common";

/** A single section in the final assembled prompt. */
export interface PromptSection {
  type: SectionType;
  content: string;
  tokens: number;
  priority: number;     // for budget trimming
  required: boolean;
  /** Optional metadata about source (file, version, hash). */
  metadata?: {
    source: string;
    version?: string;
    hash?: string;
  };
}

/** All 9 sections in order, with optional content (null = not included). */
export interface PromptSections {
  system: string | null;
  company_brain: string | null;
  agent_brain: string | null;
  workflow_context: string | null;
  memory: string | null;
  examples: string | null;
  task: string | null;
  output_schema: string | null;
  safety: string | null;
}

/** Final assembled prompt ready for the Provider Layer. */
export interface FinalPrompt {
  /** Sections in enforced order (filtered to non-null). */
  sections: PromptSection[];
  /** Concatenated full prompt string (sections joined by "\n\n"). */
  fullPrompt: string;
  /** Total tokens in the assembled prompt. */
  totalTokens: number;
  /** Tokens used vs budget. */
  budgetUsed: number;
  budgetRemaining: number;
  /** Whether any section was trimmed to fit budget. */
  trimmed: boolean;
  /** Template version used. */
  version: PromptVersion;
  /** Cache key for this prompt (for caching layer). */
  cacheKey: CacheKey;
  /** Compilation metadata. */
  metadata: CompileMetadata;
}

export interface CacheKey {
  agent: string;
  templateVersion: PromptVersion;
  contextHash: string;
  schemaHash: string;
}

export interface PromptVersion {
  major: number;
  minor: number;
  patch: number;
  hash: string;
}

export interface CompileMetadata {
  agent: string;
  templateVersion: PromptVersion;
  compileDurationMs: number;
  sectionsIncluded: string[];
  sectionsTrimmed: string[];
  cacheHit: boolean;
  timestamp: string;
}