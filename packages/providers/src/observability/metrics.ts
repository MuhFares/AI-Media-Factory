/**
 * Provider metrics (req #17).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Per-provider/model call counts, latencies, error rates, throughput — shipped
 * to infra/monitoring and the Analytics Brain.
 */

import type { ProviderId, ModelId } from "../core/common.js";

export interface CallOutcome {
  provider: ProviderId;
  model: ModelId;
  ok: boolean;
  latencyMs: number;
  errorKind?: string;
}

export interface ProviderMetrics {
  /** Record one completed (or failed) provider call. */
  record(outcome: CallOutcome): void;
  /** Snapshot for dashboards (p50/p95 latency, error rate, throughput). */
  snapshot(provider: ProviderId): {
    calls: number;
    errorRate: number;
    latencyP50Ms: number;
    latencyP95Ms: number;
  };
}
