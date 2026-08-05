/**
 * Tool Retry Policy (Req #8).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  jitter: boolean;
  retryableErrors: string[];
  nonRetryableErrors: string[];
}

export interface ToolRetryPolicy {
  shouldRetry(error: ToolError, attempt: number): boolean;
  getDelay(attempt: number): number;
  readonly maxAttempts: number;
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
  details?: any;
  cause?: any;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
  retryableErrors: ["TIMEOUT", "RATE_LIMITED", "SERVER_ERROR", "NETWORK_ERROR", "TEMPORARY_UNAVAILABLE"],
  nonRetryableErrors: ["VALIDATION_ERROR", "PERMISSION_DENIED", "APPROVAL_REJECTED", "AUTHENTICATION_ERROR", "CONTENT_FILTER", "INVALID_INPUT", "SANDBOX_VIOLATION", "COST_EXCEEDED"],
};