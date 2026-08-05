/**
 * Relevance Scoring (Req #11).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export interface RelevanceScorer {
  score(record: any, query: RetrievalQuery): RelevanceScore;
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

export interface RelevanceScore {
  score: number;
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