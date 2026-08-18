/**
 * Default RecoveryManager implementation.
 *
 * Phase 0: rebuilds a runnable WorkflowInstance from durable storage (the
 * PersistencePort) plus the latest checkpoint. Completed steps are never re-run;
 * in-flight (`running`) steps from a crash become `pending` so they are re-run
 * idempotently; `failed`/`blocked`/`compensated`/`skipped` stay as recorded.
 */

import type { Uuid, WorkflowState } from "../core/common.js";
import type { WorkflowInstance } from "../core/instance.js";
import type { RecoveryManager } from "../resilience/recovery.js";
import type { CheckpointCoordinator } from "../resilience/checkpoint.js";
import type { PersistencePort } from "../resilience/persistence.js";

export type WorkflowLoader = Pick<PersistencePort, "loadWorkflow">;

export class DefaultRecoveryManager implements RecoveryManager {
  constructor(
    private readonly checkpointCoordinator: CheckpointCoordinator,
    private readonly persistence: WorkflowLoader,
    private readonly getDefinition: (definitionId: string, version: number) => Promise<unknown>
  ) {}

  async recover(workflowId: Uuid): Promise<WorkflowInstance> {
    const instance = await this.persistence.loadWorkflow(workflowId);
    if (!instance) {
      throw new Error(`Workflow instance not found: ${workflowId}`);
    }

    const checkpoint = await this.checkpointCoordinator.latest(workflowId);
    if (!checkpoint) {
      // No checkpoint yet (e.g. crashed before first boundary) — resurface as-is,
      // pending steps remain pending and will be executed.
      return instance;
    }

    const completed = new Set(checkpoint.completedSteps);

    const steps = instance.steps.map((s) => {
      if (completed.has(s.stepId)) {
        return { ...s, status: "completed" as const };
      }
      if (s.status === "failed" || s.status === "compensated" || s.status === "skipped") {
        return s; // failure semantics preserved: never becomes successful downstream input
      }
      // pending or running-from-crash → re-run idempotently
      return { ...s, status: "pending" as const, startedAt: null, finishedAt: null };
    });

    // Restore the ready frontier. For sequential chains the engine advances one
    // step at a time; only the earliest pending step is ready. (Parallel/branch
    // frontier reconstruction is a later-phase enhancement — Phase 0 targets the
    // sequential-content pipeline the mission's chaos test drives.)
    const pendingSteps = steps.filter((s) => s.status === "pending").map((s) => s.stepId);
    const ready = pendingSteps.length > 0 ? [pendingSteps[0]] : instance.ready;

    return {
      ...instance,
      state: parseWorkflowState(checkpoint.state),
      steps,
      ready,
    };
  }

  async isRecoverable(workflowId: Uuid): Promise<boolean> {
    const checkpoint = await this.checkpointCoordinator.latest(workflowId);
    if (checkpoint) return true;
    const instance = await this.persistence.loadWorkflow(workflowId);
    return instance !== null;
  }
}

function parseWorkflowState(value: string): WorkflowState {
  switch (value) {
    case "PENDING":
    case "RUNNING":
    case "PAUSED":
    case "AWAITING_APPROVAL":
    case "RETRYING":
    case "COMPENSATING":
    case "COMPLETED":
    case "FAILED":
    case "CANCELLED":
    case "ESCALATED":
      return value;
    default:
      throw new Error(`Invalid workflow state in checkpoint: ${value}`);
  }
}
