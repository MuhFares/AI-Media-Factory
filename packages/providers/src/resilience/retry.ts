/**
 * Provider-level retry policy (req #9).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Retries within a single provider (transient 429/5xx/timeout) before the
 * router advances the fallback chain. Aligned with the Event Bus retry policy.
 */

import type { ProviderError } from "../core/errors.js";

export interface ProviderRetryPolicy {
  shouldRetry(error: ProviderError, attempt: number): boolean;
  backoffMs(attempt: number): number;
  readonly maxAttempts: number;
}
