/**
 * Workflow definition (req #1) — a versioned, declarative graph of steps.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { StepId } from "../core/common.js";
import type { Step } from "./step.js";

export type TriggerKind = "event" | "schedule" | "manual";

export interface WorkflowTrigger {
  kind: TriggerKind;
  /** Event type or cron spec that starts the workflow. */
  spec: string;
}

/** Saga policy for the whole workflow. */
export interface CompensationPolicy {
  /** Run compensation of completed steps on failure and/or cancel. */
  onFailure: boolean;
  onCancel: boolean;
}

/** A versioned workflow. A running instance pins its version. */
export interface WorkflowDefinition {
  id: string;
  version: number;
  trigger: WorkflowTrigger;
  entryStep: StepId;
  steps: Step[];
  /** Whole-workflow deadline seconds (#13). */
  timeoutSeconds?: number;
  compensation: CompensationPolicy;
}
