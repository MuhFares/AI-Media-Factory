/**
 * Context Metrics (Req #14).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export interface ContextMetrics {
  recordPackageSize(agent: string, tokens: number): void;
  recordCompression(original: number, compressed: number): void;
  recordCacheHit(): void;
  recordCacheMiss(): void;
  recordSelectionLatency(ms: number): void;
  recordCompressionRatio(ratio: number): void;
  recordBudgetUtilization(used: number, max: number): void;
  recordRelevanceScore(score: number): void;
  snapshot(): ContextMetricsSnapshot;
}

export interface ContextMetricsSnapshot {
  avgPackageTokens: number;
  avgCompressionRatio: number;
  cacheHitRate: number;
  avgSelectionLatencyMs: number;
  avgRelevanceScore: number;
  budgetUtilizationPct: number;
}