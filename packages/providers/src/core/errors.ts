/**
 * Provider error taxonomy.
 * ARCHITECTURE ONLY — type declarations, no logic (no thrown instances).
 */

import type { ProviderId, ModelId } from "./common.js";

export type ProviderErrorKind =
  | "rate_limited"     // 429 — retryable, feeds RateLimiter
  | "server_error"     // 5xx — retryable, may trigger fallback
  | "timeout"          // deadline exceeded — retryable
  | "auth"             // 401/403 — terminal, no fallback for this cause
  | "bad_request"      // 400 — terminal (malformed request)
  | "content_filter"   // vendor refused — terminal
  | "unavailable";     // circuit open / no healthy provider — triggers fallback

export interface ProviderError {
  kind: ProviderErrorKind;
  retryable: boolean;
  /** true → the router may advance the fallback chain. */
  allowFallback: boolean;
  provider: ProviderId;
  model: ModelId;
  message: string;
  cause?: unknown;
}
