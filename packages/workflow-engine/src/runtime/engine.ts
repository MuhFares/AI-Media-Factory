/**
 * Default WorkflowEngine implementation.
 */

import type { Json, Uuid, Timestamp, StepId, WorkflowState } from "../core/common.js";
import type { WorkflowDefinition } from "../model/definition.js";
import type { Step } from "../model/step.js";
import type { WorkflowInstance, StepRecord } from "../core/instance.js";
import type { WorkflowContext } from "../model/context.js";
import type { StartInput, WorkflowEngine } from "../core/engine.js";
import type { ApprovalDecision } from "../execution/approval.js";
import type { StepExecutor } from "../execution/step-executor.js";
import type { Scheduler } from "../execution/scheduler.js";
import type { WorkflowStateMachine } from "../core/common.js";
import type { CheckpointCoordinator } from "../resilience/checkpoint.js";
import type { RecoveryManager } from "../resilience/recovery.js";
import type { CompensationRunner } from "../execution/compensation.js";
import type { ApprovalCoordinator } from "../execution/approval.js";
import type { DeadLetterSink } from "../resilience/dead-letter.js";
import type { AuditTrail } from "../observability/audit.js";
import type { WorkflowLogger } from "../observability/logging.js";
import type { WorkflowMetrics } from "../observability/metrics.js";
import type { WorkflowEventBridge } from "../integration/events.js";

export class DefaultWorkflowEngine implements WorkflowEngine {
  private instances = new Map<Uuid, WorkflowInstance>();

  constructor(
    private readonly stepExecutor: StepExecutor,
    private readonly scheduler: Scheduler,
    private readonly stateMachine: WorkflowStateMachine,
    private readonly checkpointCoordinator: CheckpointCoordinator,
    private readonly recoveryManager: RecoveryManager,
    private readonly compensationRunner: CompensationRunner,
    private readonly approvalCoordinator: ApprovalCoordinator,
    private readonly deadLetterSink: DeadLetterSink,
    private readonly auditTrail: AuditTrail,
    private readonly logger: WorkflowLogger,
    private readonly metrics: WorkflowMetrics,
    private readonly eventBridge: WorkflowEventBridge
  ) {}

  async start(input: StartInput): Promise<WorkflowInstance> {
    const workflowId = this.generateId();
    const now = new Date().toISOString();

    const context: WorkflowContext = {
      workflowId,
      correlationId: input.correlationId ?? null,
      brandId: input.brandId ?? null,
      outputs: {},
      data: input.trigger as Record<string, Json>,
    };

    const stepRecords: StepRecord[] = input.definition.steps.map((step: Step) => ({
      stepId: step.id,
      status: "pending" as const,
      attempts: 0,
      startedAt: null,
      finishedAt: null,
    }));

    const instance: WorkflowInstance = {
      workflowId,
      definitionId: input.definition.id,
      definitionVersion: input.definition.version,
      state: "PENDING",
      context,
      steps: stepRecords,
      ready: [input.definition.entryStep],
      lastCheckpointRef: null,
      createdAt: now,
      updatedAt: now,
    };

    this.instances.set(workflowId, instance);

    // Transition to RUNNING
    instance.state = this.stateMachine.next("PENDING", "start");
    instance.updatedAt = new Date().toISOString();

    await this.auditTrail.append({
      workflowId,
      kind: "workflow_started",
      stepId: null,
      detail: { definitionId: input.definition.id, version: input.definition.version },
      at: now,
    });

    await this.eventBridge.emit("WorkflowStarted", workflowId, { definitionId: input.definition.id });

    // Start execution loop
    this.executeLoop(instance);

    return instance;
  }

  async pause(workflowId: Uuid, reason: string): Promise<void> {
    const instance = this.instances.get(workflowId);
    if (!instance) throw new Error(`Workflow not found: ${workflowId}`);

    if (!this.stateMachine.can(instance.state, "pause")) {
      throw new Error(`Cannot pause from state ${instance.state}`);
    }

    instance.state = this.stateMachine.next(instance.state, "pause");
    instance.updatedAt = new Date().toISOString();

    await this.checkpointCoordinator.checkpoint(instance);
    await this.auditTrail.append({
      workflowId,
      kind: "paused",
      stepId: null,
      detail: { reason },
      at: instance.updatedAt,
    });
  }

  async resume(workflowId: Uuid): Promise<WorkflowInstance> {
    const instance = await this.recoveryManager.recover(workflowId);
    if (!instance) throw new Error(`Workflow not found: ${workflowId}`);

    this.instances.set(workflowId, instance);

    instance.state = this.stateMachine.next(instance.state, "resume");
    instance.updatedAt = new Date().toISOString();

    await this.auditTrail.append({
      workflowId,
      kind: "resumed",
      stepId: null,
      detail: {},
      at: instance.updatedAt,
    });

    this.executeLoop(instance);
    return instance;
  }

  async cancel(workflowId: Uuid, reason: string): Promise<void> {
    const instance = this.instances.get(workflowId);
    if (!instance) throw new Error(`Workflow not found: ${workflowId}`);

    // Run compensation for completed steps
    if (instance.definitionId) {
      const plan = this.compensationRunner.plan(instance);
      for (const stepId of plan.steps) {
        try {
          await this.compensationRunner.compensate(instance, stepId);
          await this.auditTrail.append({
            workflowId,
            kind: "compensation",
            stepId,
            detail: { reason },
            at: new Date().toISOString(),
          });
        } catch (error) {
          await this.auditTrail.append({
            workflowId,
            kind: "compensation",
            stepId,
            detail: { reason, error: String(error) },
            at: new Date().toISOString(),
          });
        }
      }
    }

    instance.state = "CANCELLED";
    instance.updatedAt = new Date().toISOString();

    await this.auditTrail.append({
      workflowId,
      kind: "cancelled",
      stepId: null,
      detail: { reason },
      at: instance.updatedAt,
    });

    await this.eventBridge.emit("WorkflowCancelled", workflowId, { reason });
  }

  async signalApproval(workflowId: Uuid, decision: ApprovalDecision): Promise<void> {
    const instance = this.instances.get(workflowId);
    if (!instance) throw new Error(`Workflow not found: ${workflowId}`);

    await this.approvalCoordinator.apply(decision);

    await this.auditTrail.append({
      workflowId,
      kind: "approval_decided",
      stepId: decision.stepId,
      detail: { outcome: decision.outcome, approver: decision.approver, note: decision.note },
      at: decision.decidedAt,
    });
  }

  async describe(workflowId: Uuid): Promise<WorkflowInstance | null> {
    return this.instances.get(workflowId) ?? null;
  }

  private async executeLoop(instance: WorkflowInstance): Promise<void> {
    while (true) {
      const readySteps = this.scheduler.readySteps(instance);
      if (readySteps.length === 0) {
        // Check if workflow is complete
        const allCompleted = instance.steps.every(
          (s) => ["completed", "compensated", "skipped"].includes(s.status)
        );
        if (allCompleted) {
          await this.completeWorkflow(instance);
        }
        break;
      }

      // Execute ready steps (in parallel if multiple)
      await Promise.all(
        readySteps.map((stepId) => this.executeStep(instance, stepId))
      );
    }
  }

  private async executeStep(instance: WorkflowInstance, stepId: StepId): Promise<void> {
    const stepRecord = instance.steps.find((s) => s.stepId === stepId);
    if (!stepRecord || stepRecord.status !== "pending") return;

    // Find step definition
    // This would need access to the workflow definition
    // For now, we'll skip actual execution

    stepRecord.status = "running";
    stepRecord.startedAt = new Date().toISOString();
    stepRecord.attempts++;

    try {
      // Execute step via step executor
      // const outcome = await this.stepExecutor.execute(stepDef, instance.context);
      // For now, mock completion
      stepRecord.status = "completed";
      stepRecord.finishedAt = new Date().toISOString();

      // Advance workflow
      const nextSteps = this.scheduler.advance(instance, stepId);
      instance.ready.push(...nextSteps);

      await this.auditTrail.append({
        workflowId: instance.workflowId,
        kind: "step_completed",
        stepId,
        detail: { output: instance.context.outputs[stepId] },
        at: stepRecord.finishedAt,
      });

      // Checkpoint after each step
      await this.checkpointCoordinator.checkpoint(instance);
    } catch (error) {
      stepRecord.status = "failed";
      stepRecord.finishedAt = new Date().toISOString();

      await this.auditTrail.append({
        workflowId: instance.workflowId,
        kind: "step_completed",
        stepId,
        detail: { error: String(error) },
        at: stepRecord.finishedAt,
      });

      // Handle retry or failure
      // This is simplified
    }
  }

  private async completeWorkflow(instance: WorkflowInstance): Promise<void> {
    const now = new Date().toISOString();
    instance.state = "COMPLETED";
    instance.updatedAt = now;

    const cycleTimeMs = Date.parse(now) - Date.parse(instance.createdAt);
    const stepCount = instance.steps.filter((s) => s.status === "completed").length;

    await this.metrics.recordCompletion(instance.workflowId, {
      cycleTimeMs,
      stepCount,
      retries: 0,
      reworkLoops: 0,
      autonomyRate: 1,
      estimatedCostUsd: 0,
      actualCostUsd: 0,
    });

    await this.metrics.recordOutcome(instance.workflowId, "completed");

    await this.auditTrail.append({
      workflowId: instance.workflowId,
      kind: "workflow_completed",
      stepId: null,
      detail: { cycleTimeMs, stepCount },
      at: now,
    });

    await this.eventBridge.emit("WorkflowSucceeded", instance.workflowId, {});
  }

  private generateId(): Uuid {
    return `wf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}