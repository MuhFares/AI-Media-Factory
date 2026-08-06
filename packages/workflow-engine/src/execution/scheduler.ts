/**
 * Scheduler (reqs #6, #7) — sequential spine + parallel fan-out/join.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { StepId } from "../core/common.js";
import type { WorkflowInstance } from "../core/instance.js";

export interface Scheduler {
  /** Which steps are ready to run now (deps satisfied). Supports parallel. */
  readySteps(instance: WorkflowInstance): StepId[];
  /** Has a parallel join's inbound branches all completed? */
  isJoinReady(instance: WorkflowInstance, joinStep: StepId): boolean;
  /** Advance the instance after a step completes; returns next ready steps. */
  advance(instance: WorkflowInstance, completed: StepId): StepId[];
}
