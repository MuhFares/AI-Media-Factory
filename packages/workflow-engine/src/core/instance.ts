/**
 * A running workflow instance: a definition + its live execution state.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { StepId, Timestamp, Uuid, WorkflowState } from "./common.js";
import type { WorkflowContext } from "../model/context.js";

// Re-export for downstream consumers
export type { StepId } from "./common.js";

export interface StepRecord {
  stepId: StepId;
  status: "pending" | "running" | "completed" | "failed" | "compensated" | "skipped";
  attempts: number;
  startedAt: Timestamp | null;
  finishedAt: Timestamp | null;
}

/** The persisted, resumable state of one running workflow. */
export interface WorkflowInstance {
  workflowId: Uuid;
  definitionId: string;
  /** The pinned definition version this instance runs. */
  definitionVersion: number;
  state: WorkflowState;
  context: WorkflowContext;
  steps: StepRecord[];
  /** Steps currently eligible to run (supports parallel). */
  ready: StepId[];
  lastCheckpointRef: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
