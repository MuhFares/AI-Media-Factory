/**
 * Branch router (req #5) — evaluates conditional branches.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Models the QA/Brand rework loop: a gate failure branches back to a prior step.
 */

import type { StepId } from "../core/common";
import type { BranchStep } from "../model/step";
import type { WorkflowContext } from "../model/context";

export interface BranchRouter {
  /** Evaluate a branch step's predicate over context → the next step id. */
  choose(step: BranchStep, context: WorkflowContext): StepId;
}
