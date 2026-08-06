/**
 * Compensation / saga (req #15).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * On failure/cancel after some steps completed, run their compensation steps in
 * reverse order to undo side effects (e.g. un-publish, release a reservation).
 */

import type { StepId } from "../core/common.js";
import type { WorkflowInstance } from "../core/instance.js";

export interface CompensationPlan {
  /** Completed steps that have a compensation, newest-first. */
  steps: StepId[];
}

export interface CompensationRunner {
  /** Build the reverse-order plan of compensations for completed steps. */
  plan(instance: WorkflowInstance): CompensationPlan;
  /** Execute one compensation step (best-effort, audited). */
  compensate(instance: WorkflowInstance, stepId: StepId): Promise<void>;
}
