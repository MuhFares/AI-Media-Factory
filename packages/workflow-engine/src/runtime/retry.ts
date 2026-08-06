/**
 * Default WorkflowRetryPolicy implementation.
 */

import type { StepError, WorkflowRetryPolicy } from "../resilience/retry.js";

export class DefaultWorkflowRetryPolicy implements WorkflowRetryPolicy {
  readonly maxAttempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly backoffMultiplier: number;
  readonly jitter: boolean;

  constructor(options: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    jitter?: boolean;
  } = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelayMs = options.baseDelayMs ?? 1000;
    this.maxDelayMs = options.maxDelayMs ?? 30000;
    this.backoffMultiplier = options.backoffMultiplier ?? 2;
    this.jitter = options.jitter ?? true;
  }

  shouldRetry(error: StepError, attempt: number): boolean {
    if (attempt >= this.maxAttempts) return false;
    return error.retryable;
  }

  backoffMs(attempt: number): number {
    const delay = Math.min(
      this.baseDelayMs * Math.pow(this.backoffMultiplier, attempt),
      this.maxDelayMs
    );
    return this.jitter ? delay * (0.5 + Math.random() * 0.5) : delay;
  }
}