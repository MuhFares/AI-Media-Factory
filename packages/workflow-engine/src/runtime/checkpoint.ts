/**
 * Default CheckpointCoordinator implementation.
 */

import type { Uuid } from "../core/common.js";
import type { WorkflowInstance } from "../core/instance.js";
import type { WorkflowCheckpoint, CheckpointCoordinator } from "../resilience/checkpoint.js";

export class DefaultCheckpointCoordinator implements CheckpointCoordinator {
  constructor(
    private readonly getCheckpointStore: () => {
      save(scope: string, record: any): Promise<{ id: string; version: number }>;
      retrieve(query: any): Promise<{ records: any[]; totalConfidence: number }>;
    }
  ) {}

  async checkpoint(instance: WorkflowInstance): Promise<WorkflowCheckpoint> {
    const store = this.getCheckpointStore();
    const completedSteps = instance.steps
      .filter((s) => s.status === "completed")
      .map((s) => s.stepId);

    const checkpoint: WorkflowCheckpoint = {
      workflowId: instance.workflowId,
      state: instance.state,
      completedSteps,
      contextSnapshotRef: `ctx-${instance.workflowId}-${Date.now()}`,
      lastEventOffset: 0,
      createdAt: new Date().toISOString(),
    };

    const result = await store.save("checkpoint", {
      memory_id: checkpoint.contextSnapshotRef,
      type: "checkpoint",
      agent: null,
      brand_id: null,
      body: checkpoint,
      confidence: 1.0,
      provenance: { sources: [{ type: "workflow-engine", ref: "checkpoint" }], derived_by: "workflow-engine" },
      created_at: checkpoint.createdAt,
      last_reinforced: null,
      supersedes: null,
      superseded_by: null,
      version: 1,
    });

    return { ...checkpoint, contextSnapshotRef: result.id };
  }

  async latest(workflowId: Uuid): Promise<WorkflowCheckpoint | null> {
    const store = this.getCheckpointStore();
    const result = await store.retrieve({
      filter: { workflowId },
      limit: 1,
    });

    if (result.records.length === 0) return null;
    return result.records[0].body as WorkflowCheckpoint;
  }
}