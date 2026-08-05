/**
 * Context Ranking (Req #2, #11).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { MemoryRecord } from "../selection/selector";

export interface RelevanceScore {
  score: number; // 0..1
  factors: {
    semanticSimilarity: number;
    graphProximity: number;
    keywordMatch: number;
    recency: number;
    performance: number;
    confidence: number;
  };
  explanation: string;
}

export interface RankSignals {
  relevance: number;
  freshness: number;
  confidence: number;
  priority: number;
  performance: number;
}

export interface RankedRecord {
  record: MemoryRecord;
  score: number;
  signals: RankSignals;
}

export interface RankingStrategy {
  rank(records: MemoryRecord[], query: RetrievalQuery, rules: RetrievalRules): RankedRecord[];
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

export interface RankingContext {
  reliability: Record<string, number>;
  weights?: { cost: number; latency: number; reliability: number };
}

export interface RankingStrategy {
  readonly id: string;
  rank(candidates: any[], context: RankingContext): any[];
}

export interface ContextRanker {
  rank(records: any[], query: any, rules: any): Promise<any[]>;
}