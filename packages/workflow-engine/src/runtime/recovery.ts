/**
 * Default RecoveryManager implementation.
 */

import type { Uuid } from "../core/common.js";
import type { WorkflowInstance } from "../core/instance.js";
import type { RecoveryManager } from "../resilience/recovery.js";
import type { WorkflowCheckpoint, CheckpointCoordinator } from "../resilience/checkpoint.js";

export class DefaultRecoveryManager implements RecoveryManager {
  constructor(
    private readonly checkpointCoordinator: CheckpointCoordinator,
    private readonly getWorkflowInstance: (workflowId: Uuid) => Promise<WorkflowInstance | null>,
    private readonly getDefinition: (definitionId: string, version: number) => Promise<any>
  ) {}

  async recover(workflowId: Uuid): Promise<WorkflowInstance> {
    const checkpoint = await this.checkpointCoordinator.latest(workflowId);
    if (!checkpoint) {
      throw new Error(`No checkpoint found for workflow ${workflowId}`);
    }

    const instance = await this.getWorkflowInstance(workflowId);
    if (!instance) {
      throw new Error(`Workflow instance not found: ${workflowId}`);
    }

    // Restore from checkpoint
    return {
      ...instance,
      state: checkpoint.state as any,
      context: instance.context, // Would restore from contextSnapshotRef
      steps: instance.steps.map((s) => {
        if (checkpoint.completedSteps.includes(s.stepId)) {
          return { ...s, status: "completed" as const };
        }
        return { ...s, status: "pending" as const };
      }),
      ready: this.determineReadySteps(instance, checkpoint.completedSteps),
    };
  }

  async isRecoverable(workflowId: Uuid): Promise<boolean> {
    const checkpoint = await this.checkpointCoordinator.latest(workflowId);
    return checkpoint !== null;
  }

  private determineReadySteps(instance: WorkflowInstance, completedSteps: string[]): string[] {
    // Determine which steps are ready based on completed steps
    // This is a simplified version; real implementation would use the Scheduler
    return instance.steps
      .filter((s) => s.status === "pending" && this.areDependenciesMet(s.stepId, completedSteps, instance))
      .map((s) => s.stepId);
  }

  private areDependenciesMet(stepId: string, completedSteps: string[], instance: WorkflowInstance): boolean {
    // Check if all dependencies of this step are completed
    // Simplified: assume sequential dependencies
    return true;
  }
}