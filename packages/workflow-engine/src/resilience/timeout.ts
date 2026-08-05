/**
 * Timeouts (req #13) — per-step and per-workflow deadlines.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { StepId, Uuid } from "../core/common";

export interface TimeoutController {
  /** Per-step deadline (from agent config timeout_seconds). */
  stepDeadline(stepId: StepId, seconds: number): Date;
  /** Whole-workflow deadline (from the definition). */
  workflowDeadline(workflowId: Uuid, seconds: number): Date;
  /** Has a deadline elapsed as of now? */
  isExpired(deadline: Date): boolean;
}
