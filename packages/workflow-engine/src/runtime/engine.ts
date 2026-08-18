/**
 * Default WorkflowEngine implementation.
 *
 * Phase 0: the engine persists its execution state through the PersistencePort
 * so a workflow can be reconstructed and resumed after a process restart.
 * When no persistence port is supplied the engine degrades to the original
 * in-memory-only behaviour (used by legacy tests).
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
import { WorkflowCrashError } from "../resilience/persistence.js";
import type { PersistencePort } from "../resilience/persistence.js";

export class DefaultWorkflowEngine implements WorkflowEngine {
  private instances = new Map<Uuid, WorkflowInstance>();
  private definitions = new Map<Uuid, WorkflowDefinition>();

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
    private readonly eventBridge: WorkflowEventBridge,
    /** Optional durable backing store. When absent the engine is in-memory only. */
    private readonly persistence?: PersistencePort,
    /** Reloads a workflow definition by id+version (needed to resume a recovered instance). */
    private readonly definitionLoader?: (definitionId: string, version: number) => Promise<WorkflowDefinition | null>
  ) {}

  async start(input: StartInput): Promise<WorkflowInstance> {
    const workflowId = input.workflowId ?? this.generateId();
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
    this.definitions.set(workflowId, input.definition);

    // Transition to RUNNING
    instance.state = this.stateMachine.next("PENDING", "start");
    instance.updatedAt = new Date().toISOString();

    await this.persist(instance);

    await this.auditTrail.append({
      workflowId,
      kind: "workflow_started",
      stepId: null,
      detail: { definitionId: input.definition.id, version: input.definition.version },
      at: now,
    });

    await this.eventBridge.emit("WorkflowStarted", workflowId, { definitionId: input.definition.id });

    // Start execution loop (fire-and-forget so callers can observe RUNNING).
    void this.executeLoop(instance).catch((err) => {
      if (err instanceof WorkflowCrashError) return;
      this.logger.log("error", "Workflow loop terminated unexpectedly", { workflow_id: workflowId, error: String(err) });
    });

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
    await this.persist(instance);
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

    // A crashed-in-flight workflow stays RUNNING; a paused one transitions back.
    instance.state = this.stateMachine.can(instance.state, "resume")
      ? this.stateMachine.next(instance.state, "resume")
      : instance.state;
    instance.updatedAt = new Date().toISOString();

    this.instances.set(workflowId, instance);

    // Reload the definition so the recovered instance can keep executing steps.
    if (this.definitionLoader) {
      const def = await this.definitionLoader(instance.definitionId, instance.definitionVersion);
      if (def) this.definitions.set(workflowId, def);
    }

    await this.persist(instance);
    await this.auditTrail.append({
      workflowId,
      kind: "resumed",
      stepId: null,
      detail: {},
      at: instance.updatedAt,
    });

    void this.executeLoop(instance).catch((err) => {
      if (err instanceof WorkflowCrashError) return;
      this.logger.log("error", "Workflow resume loop terminated unexpectedly", { workflow_id: workflowId, error: String(err) });
    });
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

    await this.persist(instance);
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
    const cached = this.instances.get(workflowId);
    if (cached) return cached;
    if (this.persistence) return this.persistence.loadWorkflow(workflowId);
    return null;
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
      try {
        await Promise.all(
          readySteps.map((stepId) => this.executeStep(instance, stepId))
        );
      } catch (error) {
        // A crash interrupts the loop; remaining steps stay pending so recovery
        // can re-run them idempotently. This is NOT a terminal workflow failure.
        if (error instanceof WorkflowCrashError) throw error;
        throw error;
      }
    }
  }

  private async executeStep(instance: WorkflowInstance, stepId: StepId): Promise<void> {
    const stepRecord = instance.steps.find((s) => s.stepId === stepId);
    if (!stepRecord || (stepRecord.status !== "pending" && stepRecord.status !== "failed")) return;

    const definition = this.definitions.get(instance.workflowId);
    const stepDef = definition?.steps.find((s) => s.id === stepId);

    stepRecord.status = "running";
    stepRecord.startedAt = new Date().toISOString();
    stepRecord.attempts += 1;

    try {
      if (stepDef === undefined) {
        // No definition available (legacy stub path) — mark completed.
        stepRecord.status = "completed";
        stepRecord.finishedAt = new Date().toISOString();
        this.advance(instance, stepDef ?? null, stepId);
      } else {
        const outcome = await this.stepExecutor.execute(stepDef, instance.context);
        if (outcome.status === "awaiting_approval") {
          instance.state = "AWAITING_APPROVAL";
          stepRecord.status = "running";
          await this.checkpointCoordinator.checkpoint(instance);
          await this.persist(instance);
          return;
        }
        if (outcome.status === "failed") {
          stepRecord.status = "failed";
          stepRecord.finishedAt = new Date().toISOString();
          await this.auditTrail.append({
            workflowId: instance.workflowId,
            kind: "step_failed",
            stepId,
            detail: { error: outcome.error?.message ?? "step failed" },
            at: stepRecord.finishedAt,
          });
          await this.checkpointCoordinator.checkpoint(instance);
          await this.persist(instance);
          return;
        }
        // completed
        instance.context.outputs[stepId] = outcome.output;
        if (outcome.artifact !== undefined && this.persistence) {
          await this.persistence.saveArtifact(outcome.artifact);
        }
        stepRecord.status = "completed";
        stepRecord.finishedAt = new Date().toISOString();
        this.advance(instance, stepDef, stepId);
      }

      await this.auditTrail.append({
        workflowId: instance.workflowId,
        kind: "step_completed",
        stepId,
        detail: { output: instance.context.outputs[stepId] },
        at: stepRecord.finishedAt,
      });

      // Checkpoint + persist after each step (write-ahead durability).
      await this.checkpointCoordinator.checkpoint(instance);
      await this.persist(instance);
    } catch (error) {
      if (error instanceof WorkflowCrashError) {
        // Process interrupted mid-step: leave step in-flight (running) so it is
        // re-run idempotently after recovery. Persist the durable frontier.
        await this.checkpointCoordinator.checkpoint(instance);
        await this.persist(instance);
        throw error;
      }
      stepRecord.status = "failed";
      stepRecord.finishedAt = new Date().toISOString();

      await this.auditTrail.append({
        workflowId: instance.workflowId,
        kind: "step_failed",
        stepId,
        detail: { error: String(error) },
        at: stepRecord.finishedAt,
      });
      await this.checkpointCoordinator.checkpoint(instance);
      await this.persist(instance);
    }
  }

  /** Engine-driven sequential advancement using the stored definition. */
  private advance(instance: WorkflowInstance, stepDef: Step | null, completed: StepId): void {
    if (!stepDef) return;
    const next = stepDef.next;
    if (next === undefined) return;
    const nextSteps = Array.isArray(next) ? next : [next];
    for (const id of nextSteps) {
      if (!instance.ready.includes(id)) instance.ready.push(id);
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
    await this.persist(instance);

    await this.auditTrail.append({
      workflowId: instance.workflowId,
      kind: "workflow_completed",
      stepId: null,
      detail: { cycleTimeMs, stepCount },
      at: now,
    });

    await this.eventBridge.emit("WorkflowSucceeded", instance.workflowId, {});
  }

  private async persist(instance: WorkflowInstance): Promise<void> {
    if (!this.persistence) return;
    await this.persistence.saveWorkflow(instance);
  }

  private generateId(): Uuid {
    return `wf-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
}
