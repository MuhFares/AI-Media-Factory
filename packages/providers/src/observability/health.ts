/**
 * Provider health monitoring + circuit breaker (req #16).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { ProviderId } from "../core/common.js";

export type HealthStatus = "healthy" | "degraded" | "unavailable";

export interface HealthState {
  status: HealthStatus;
  /** Circuit breaker: when open, routing skips this provider. */
  circuitOpen: boolean;
  detail: string | null;
  observedAt: string;
}

/**
 * Tracks provider health from probes and passive call outcomes; opens a
 * circuit after an error threshold and closes it on recovery. The Router
 * consults this to filter unhealthy providers before selection.
 */
export interface HealthMonitor {
  /** Current health of a provider (for the routing health filter). */
  status(provider: ProviderId): HealthState;
  isHealthy(provider: ProviderId): boolean;
  /** Feed a call outcome so health/circuit state can update. */
  recordOutcome(provider: ProviderId, ok: boolean, detail?: string): void;
}
