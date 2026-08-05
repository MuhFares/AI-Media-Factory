/**
 * Runtime error taxonomy.
 * ARCHITECTURE ONLY — type declarations, no logic (no thrown instances here).
 */

export type RuntimeErrorKind =
  | "LoadError"
  | "SchemaValidationError"
  | "ProviderError"
  | "TimeoutError"
  | "BudgetExceededError"
  | "CancellationError"
  | "ApprovalRejected";

/** Every failure in the runtime is described by this shape. */
export interface RuntimeError {
  kind: RuntimeErrorKind;
  /** Whether the RetryPolicy may retry this error. */
  retryable: boolean;
  /** true → send to dead-letter; false → recover/escalate/terminal per kind. */
  deadLetter: boolean;
  message: string;
  /** The pipeline stage where it occurred (LOADING, EXECUTING, ...). */
  stage: string;
  cause?: unknown;
}
