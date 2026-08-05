/**
 * Context Selection (Req #1, #9).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Json, AgentId, WorkflowId, StepId, TurnId, MemoryId } from "../core/common";

export interface RetrievalRules {
  /** Maximum memory records to retrieve per type. */
  maxPerType: Record<string, number>;
  /** Minimum relevance score (0..1). */
  minRelevance: number;
  /** Minimum confidence (0..1). */
  minConfidence: number;
  /** Required capabilities for retrieved memory. */
  requiredCapabilities?: string[];
  /** Boost recent memory? */
  recencyBoost: boolean;
  /** Diversity factor (0..1) to avoid duplicates. */
  diversityFactor: number;
  /** Include superseded memories? */
  includeSuperseded: boolean;
}

export interface RetrievalRulesSummary {
  maxPerType: Record<string, number>;
  minRelevance: number;
  minConfidence: number;
  recencyBoost: boolean;
  diversityFactor: number;
}

export interface RetrievalQuery {
  agent: string;
  workflowId?: string;
  stepId?: string;
  text?: string;
  filter?: Record<string, any>;
  mode?: "semantic" | "vector" | "graph" | "keyword" | "hybrid";
  topK?: number;
}

export interface RetrievalRules {
  maxPerType: Record<string, number>;
  minRelevance: number;
  minConfidence: number;
  requiredCapabilities?: string[];
  recencyBoost: boolean;
  diversityFactor: number;
  includeSuperseded: boolean;
}

export interface ContextSelector {
  /** Select relevant context for a request. */
  select(request: ContextSelectionRequest): Promise<SelectionResult>;
}

export interface ContextSelectionRequest {
  agent: string;
  workflowId?: string;
  stepId?: string;
  turnId: string;
  trigger: string;
  query?: string;
  overrides?: {
    forceInclude?: string[];
    exclude?: string[];
    tokenBudgetOverride?: number;
    forceIncludeIds?: string[];
    minConfidence?: number;
  };
}

export interface SelectionResult {
  memory: LoadedMemory;
  workflowContext?: WorkflowContextSection;
  sessionContext: SessionContextSection;
  rulesApplied: RetrievalRules;
  ranking: RankingSummary;
}

export interface LoadedMemory {
  shortTerm: MemoryRecord[];
  longTerm: MemoryRecord[];
}

export interface MemoryRecord {
  memory_id: string;
  type: string;
  agent: string | null;
  brand_id: string | null;
  body: any;
  confidence: number;
  provenance: {
    sources: Array<{ type: string; ref: string }>;
    derived_by: string;
  };
  created_at: string;
  last_reinforced: string | null;
  supersedes: string | null;
  superseded_by: string | null;
  version: number;
}

export interface RankingSummary {
  totalCandidates: number;
  selected: number;
  strategy: string;
  topScore: number;
  avgScore: number;
}

export interface WorkflowContextSection {
  workflowId: string;
  correlationId: string | null;
  brandId: string | null;
  currentStep: string;
  relevantOutputs: Record<string, any>;
  data: Record<string, any>;
  tokens: number;
}

export interface SessionContextSection {
  turnId: string;
  workflowId: string | null;
  agent: string;
  scratch: any;
  recentEvents: EventSummary[];
  tokens: number;
}

export interface EventSummary {
  eventId: string;
  type: string;
  stepId: string | null;
  timestamp: string;
  outcome: "success" | "failure" | "partial";
}

export interface ContextSelector {
  select(request: ContextSelectionRequest): Promise<SelectionResult>;
}