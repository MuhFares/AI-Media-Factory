/**
 * Rate limiting (req #10).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Enforces per-provider request and token budgets so the router skips a
 * provider with no budget right now (a routing filter, not just a throttle).
 */

import type { ProviderId } from "../core/common.js";

export interface RateLimitState {
  requestsRemaining: number;
  tokensRemaining: number;
  resetsAt: string;
}

/** Token-bucket style per-provider limiter. */
export interface RateLimiter {
  /** Does the provider have budget for an estimated token cost now? */
  hasBudget(provider: ProviderId, estimatedTokens: number): boolean;
  /** Reserve budget for an in-flight call. */
  reserve(provider: ProviderId, estimatedTokens: number): void;
  /** Reconcile actual usage after a call completes. */
  settle(provider: ProviderId, actualTokens: number): void;
  state(provider: ProviderId): RateLimitState;
}
