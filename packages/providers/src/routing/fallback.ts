/**
 * Fallback strategy (req #8).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { ModelDescriptor } from "../registry/model-registry.js";
import type { LlmProvider } from "../core/provider.js";
import type { ProviderError } from "../core/errors.js";

export type FallbackCandidate = { provider: LlmProvider; model: ModelDescriptor };

/**
 * Advances through the ranked fallback chain when a provider call fails in a
 * way that permits fallback (retryable/unavailable), stopping on terminal
 * errors (auth/bad_request) or when the chain is exhausted.
 */
export interface FallbackStrategy {
  /** Given the last error and the remaining chain, pick the next candidate or null. */
  next(error: ProviderError, remaining: FallbackCandidate[]): FallbackCandidate | null;
}
