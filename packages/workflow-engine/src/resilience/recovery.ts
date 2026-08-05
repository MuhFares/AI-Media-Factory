/**
 * Recovery / resume (req #10).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Rebuild an instance from its last checkpoint and continue. Already-completed
 * steps are skipped (idempotent replay, dedupe by step/event id).
 */

import type { Uuid } from "../core/common";
import type { WorkflowInstance } from "../core/instance";

export interface RecoveryManager {
  /** Reconstruct a runnable instance from the last checkpoint. */
  recover(workflowId: Uuid): Promise<WorkflowInstance>;
  /** Determine whether a failed workflow is recoverable (resume vs DLQ). */
  isRecoverable(workflowId: Uuid): Promise<boolean>;
}
