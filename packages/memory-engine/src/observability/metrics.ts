/**
 * Memory metrics (req #25).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Retrieval latency, hit/miss, records-per-query, confidence distribution,
 * conflict rate, compression ratio, expiration/archival volumes, cache hit
 * rate, and the learning-loop signal. Shipped to infra/monitoring + Analytics.
 */

import type { MemoryType } from "../core/common.js";

export interface RetrievalMetric {
  type: MemoryType;
  latencyMs: number;
  candidateCount: number;
  returnedCount: number;
  cacheHit: boolean;
}

export interface MemoryMetrics {
  recordRetrieval(metric: RetrievalMetric): void;
  recordWrite(type: MemoryType, superseded: boolean): void;
  recordConflict(type: MemoryType, resolution: string): void;
  recordLifecycle(op: "compress" | "expire" | "archive", type: MemoryType, count: number): void;
  /** The learning-loop signal: memories reinforced / lessons advanced per workflow. */
  recordLearning(workflowId: string, reinforced: number, lessonsAdvanced: number): void;
  snapshot(type: MemoryType): {
    retrievalP50Ms: number;
    retrievalP95Ms: number;
    cacheHitRate: number;
    conflictRate: number;
  };
}
