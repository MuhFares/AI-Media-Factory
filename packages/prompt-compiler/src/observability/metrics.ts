/**
 * Compiler Metrics (Req #20).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { AgentId } from "../core/common";

export interface CompilerMetrics {
  /** Record a compilation attempt. */
  recordCompile(agent: AgentId, durationMs: number, tokens: number, cached: boolean): void;

  /** Record a cache hit. */
  recordCacheHit(agent: string): void;

  /** Record a cache miss. */
  recordCacheMiss(agent: string): void;

  /** Record a validation failure. */
  recordValidationFailure(agent: string, code: string): void;

  /** Record budget exceeded event. */
  recordBudgetExceeded(agent: string, overage: number): void;

  /** Snapshot of current metrics. */
  snapshot(): MetricsSnapshot;
}

export interface MetricsSnapshot {
  avgCompileMs: number;
  cacheHitRate: number;
  avgTokens: number;
  budgetExceedRate: number;
  totalCompilations: number;
  cacheHits: number;
  cacheMisses: number;
  validationFailures: number;
}

export interface AgentMetrics {
  agent: string;
  compilations: number;
  avgLatencyMs: number;
  cacheHitRate: number;
  avgTokens: number;
  budgetExceedCount: number;
  validationFailures: number;
}