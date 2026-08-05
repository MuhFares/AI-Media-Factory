/**
 * Selection strategies: cost-aware / latency-aware / balanced (reqs #5–#7).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { ModelDescriptor } from "../registry/model-registry.js";

export type SelectionStrategyId = "cost_aware" | "latency_aware" | "balanced";

/** Inputs a strategy uses to rank candidate models. */
export interface RankingContext {
  /** Observed reliability per model (0..1) from HealthMonitor/metrics. */
  reliability: Record<string, number>;
  /** Weights for the Balanced strategy. */
  weights?: { cost: number; latency: number; reliability: number };
}

/** Ranks candidate models best-first for a given strategy. */
export interface SelectionStrategy {
  readonly id: SelectionStrategyId;
  rank(candidates: ModelDescriptor[], context: RankingContext): ModelDescriptor[];
}
