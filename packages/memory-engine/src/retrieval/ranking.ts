/**
 * Ranking algorithm (composite score).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Rank = w1·Relevance + w2·Recency + w3·Performance + w4·Confidence − w5·Conflict
 * Weights are per-type/per-agent and are recalibrated by the learning loop.
 */

import type { MemoryRecord } from "../core/record.js";
import type { RankedRecord } from "../core/query.js";

export interface RankSignal {
  relevance: number;
  recency: number;
  performance: number;
  confidence: number;
  conflictPenalty: number;
}

export interface RankWeights {
  relevance: number;
  recency: number;
  performance: number;
  confidence: number;
  conflict: number;
}

/** Ranks candidate records best-first using the composite score. */
export interface RankingStrategy {
  rank(candidates: MemoryRecord[], signals: Map<string, RankSignal>, weights: RankWeights): RankedRecord[];
}
