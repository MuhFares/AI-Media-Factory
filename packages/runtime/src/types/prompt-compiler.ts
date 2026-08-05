/**
 * Local type definitions for @ai-media-factory/prompt-compiler
 * Used when the package is not yet built.
 */

export type AgentId = string;
export type Json = unknown;
export type Timestamp = string;
export type Uuid = string;

export interface PromptContext {
  agent: AgentId;
  config: any;
  prompts: any;
  memory: any;
  workflow: any;
  inputEvent: any;
  outputSchema: any;
  guardrails: any;
  budget: TokenBudget;
}

export interface TokenBudget {
  total: number;
  reservedForCompletion: number;
  maxPromptTokens: number;
  allocations: SectionAllocation[];
}

export interface SectionAllocation {
  section: string;
  maxTokens: number;
  priority: number;
  flexible: boolean;
}

export interface PromptSection {
  type: string;
  content: string;
  tokens: number;
  priority: number;
  required: boolean;
  metadata?: {
    source: string;
    version?: string;
    hash?: string;
  };
}

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

export interface FinalPrompt {
  sections: PromptSection[];
  fullPrompt: string;
  totalTokens: number;
  budgetUsed: number;
  budgetRemaining: number;
  trimmed: boolean;
  version: PromptVersion;
  cacheKey: CacheKey;
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

export interface PromptCompiler {
  assemble(context: PromptContext): Promise<FinalPrompt>;
  assembleUncached(context: PromptContext): Promise<FinalPrompt>;
  invalidateCache(agent: AgentId): Promise<void>;
}