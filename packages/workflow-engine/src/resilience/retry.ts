/**
 * Workflow/step retry policy (req #8).
 * ARCHITECTURE ONLY — declarations, no logic.
 * Aligned with the Event Bus and Runtime retry policies.
 */

export interface StepError {
  message: string;
  retryable: boolean;
}

export interface WorkflowRetryPolicy {
  shouldRetry(error: StepError, attempt: number): boolean;
  backoffMs(attempt: number): number;
  readonly maxAttempts: number; // default 3
}
