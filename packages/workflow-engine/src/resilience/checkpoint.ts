/**
 * Checkpointing (req #9).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * The workflow engine does NOT define its own checkpoint storage. It binds to
 * the Memory Engine's CheckpointStore (single source of truth). This module
 * declares the workflow-level checkpoint shape and the boundary policy.
 */

import type { Uuid } from "../core/common";
import type { WorkflowInstance } from "../core/instance";

/** A workflow checkpoint = a resumable snapshot of an instance at a boundary. */
export interface WorkflowCheckpoint {
  workflowId: Uuid;
  state: string;
  completedSteps: string[];
  contextSnapshotRef: string;
  lastEventOffset: number;
  createdAt: string;
}

/**
 * Writes a checkpoint at every step boundary via the Memory Engine. Write-ahead:
 * the checkpoint is durable before the workflow advances.
 */
export interface CheckpointCoordinator {
  checkpoint(instance: WorkflowInstance): Promise<WorkflowCheckpoint>;
  latest(workflowId: Uuid): Promise<WorkflowCheckpoint | null>;
}
