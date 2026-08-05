/**
 * Resilience contracts: retries, checkpoints, cancellation, timeout.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Json, Uuid } from "./common.js";

/** Decides whether/how to retry a failed step. Mirrors the Event Bus policy. */
export interface RetryPolicy {
  /** Should the given attempt be retried? */
  shouldRetry(error: import("./errors.js").RuntimeError, attempt: number): boolean;
  /** Backoff delay (ms) before the next attempt. */
  backoffMs(attempt: number): number;
  readonly maxAttempts: number;
}

/** A durable snapshot allowing a turn/workflow to resume after a crash or pause. */
export interface Checkpoint {
  turnId: Uuid;
  workflowId: Uuid;
  state: string; // execution state machine node
  lastEventOffset: number;
  data: Json;
  createdAt: string;
}

/** Write-ahead checkpointing at state boundaries; replay is idempotent. */
export interface CheckpointManager {
  write(checkpoint: Checkpoint): Promise<void>;
  read(turnId: Uuid): Promise<Checkpoint | null>;
}

/** Cooperative cancellation signal handed to in-flight work. */
export interface CancellationToken {
  readonly isCancelled: boolean;
  onCancelled(handler: () => void): void;
  throwIfCancelled(): void;
}

/** Enforces per-step and per-turn deadlines. */
export interface TimeoutController {
  /** Run work under a deadline; rejects with TimeoutError on expiry. */
  withTimeout<T>(ms: number, work: (signal: CancellationToken) => Promise<T>): Promise<T>;
}
