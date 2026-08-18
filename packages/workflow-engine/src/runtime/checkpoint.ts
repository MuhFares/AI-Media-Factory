/**
 * Default CheckpointCoordinator implementation.
 *
 * Phase 0: checkpoints are written to the PersistencePort (durable), instead of
 * the former duck-typed Memory Engine store. `lastEventOffset` is tracked by the
 * number of already-completed steps so recovery can resume without replaying
 * completed steps (idempotent).
 */

import type { Uuid } from "../core/common.js";
import type { WorkflowInstance } from "../core/instance.js";
import type { WorkflowCheckpoint, CheckpointCoordinator } from "../resilience/checkpoint.js";
import type { PersistencePort } from "../resilience/persistence.js";

export type CheckpointPersistence = Pick<PersistencePort, "saveCheckpoint" | "loadLatestCheckpoint">;

export class DefaultCheckpointCoordinator implements CheckpointCoordinator {
  constructor(private readonly persistence?: CheckpointPersistence) {}

  async checkpoint(instance: WorkflowInstance): Promise<WorkflowCheckpoint> {
    const completedSteps = instance.steps
      .filter((s) => s.status === "completed")
      .map((s) => s.stepId);

    const checkpoint: WorkflowCheckpoint = {
      workflowId: instance.workflowId,
      state: instance.state,
      completedSteps,
      contextSnapshotRef: `ctx-${instance.workflowId}-${Date.now()}`,
      lastEventOffset: completedSteps.length,
      createdAt: new Date().toISOString(),
    };

    if (this.persistence) {
      await this.persistence.saveCheckpoint(checkpoint);
      return checkpoint;
    }

    // Legacy fallback — no durable store supplied.
    return checkpoint;
  }

  async latest(workflowId: Uuid): Promise<WorkflowCheckpoint | null> {
    if (this.persistence) return this.persistence.loadLatestCheckpoint(workflowId);
    return null;
  }
}
