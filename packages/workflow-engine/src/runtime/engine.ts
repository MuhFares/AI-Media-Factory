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
import { ProductionPolicyEnforcer, policyDecisionId } from "../resilience/production-policy-enforcement.js";

/**
 * Owner-authorized bounded execution marker (generic; set by recovery
 * dispatch, read here). When present and the named step completes freshly
 * within this run, the engine halts after it instead of advancing.
 */
export interface BoundedStageExecution {
  readonly stopAfterStepId: string;
  readonly reason: string;
  readonly authorization: string;
  readonly recoveryExecutionId: string | null;
}

export function readBoundedStopAfter(instance: WorkflowInstance, stepId: string): BoundedStageExecution | null {
  const data = (instance.context.data ?? {}) as Record<string, unknown>;
  const marker = data.boundedExecution;
  if (marker === null || typeof marker !== "object" || Array.isArray(marker)) return null;
  const record = marker as Record<string, unknown>;
  if (record.stopAfterStepId !== stepId || typeof record.stopAfterStepId !== "string") return null;
  if (typeof record.reason !== "string" || typeof record.authorization !== "string") return null;
  return {
    stopAfterStepId: record.stopAfterStepId,
    reason: record.reason,
    authorization: record.authorization,
    recoveryExecutionId: typeof record.recoveryExecutionId === "string" ? record.recoveryExecutionId : null,
  };
}

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
    private readonly definitionLoader?: (definitionId: string, version: number) => Promise<WorkflowDefinition | null>,
    private readonly policyEnforcer: ProductionPolicyEnforcer | null = persistence ? new ProductionPolicyEnforcer(persistence) : null
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
    if (this.persistence && this.policyEnforcer) {
      const decisions = await this.persistence.listDecisions(workflowId);
      const definition = this.definitions.get(workflowId);
      const missing = instance.steps.find((step) => step.status === "running" && definition?.steps.some((def) => def.id === step.stepId) && !decisions.some((row) => row.kind === "production_policy" && row.decisionId === policyDecisionId({ workflowId, sourceStage: typeof instance.context.data.currentStage === "string" ? instance.context.data.currentStage : "workflow", targetStage: step.stepId, ruleId: `workflow-transition-${step.stepId}` }, "v1")));
      if (missing) throw Object.assign(new Error("MISSING_POLICY_DECISION"), { code: "MISSING_POLICY_DECISION", stepId: missing.stepId });
    }

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

    // Definition upgrade reconciliation: a reloaded definition may contain new
    // steps (e.g. PRE_PRODUCTION_OWNER_GATE) that the persisted instance's step
    // records predate. Append pending records for them — never alter existing
    // records — so the upgraded gate is reachable on the recovered frontier.
    // Terminal (including historical) instances are never mutated.
    const reloadedDefinition = this.definitions.get(workflowId);
    if (reloadedDefinition && !this.stateMachine.isTerminal(instance.state)) {
      const known = new Set(instance.steps.map((step) => step.stepId));
      const missing = reloadedDefinition.steps.filter((step) => !known.has(step.id));
      if (missing.length > 0) {
        instance.steps.push(...missing.map((step) => ({
          stepId: step.id,
          status: "pending" as const,
          attempts: 0,
          startedAt: null,
          finishedAt: null,
        })));
      }
    }

    await this.persist(instance);
    await this.auditTrail.append({
      workflowId,
      kind: "resumed",
      stepId: null,
      detail: {},
      at: instance.updatedAt,
    });

    if (["AWAITING_APPROVAL", "REVISION_REQUIRED", "BUSINESS_BLOCKED"].includes(instance.state)) return instance;
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

    const existingDecision = instance.context.outputs[decision.stepId] as Record<string, Json> | undefined;
    if ((existingDecision?.outcome === "approved" || existingDecision?.outcome === "policy_bypass") && existingDecision.approver === decision.approver) return;
    // Exactly-once gate decisions: a gate record already resolved by an
    // earlier (possibly concurrent or redelivered) decision is never re-applied.
    const priorRecord = instance.steps.find((step) => step.stepId === decision.stepId);
    const priorStepDef = this.definitions.get(workflowId)?.steps.find((step) => step.id === decision.stepId);
    if (priorStepDef?.kind === "gate" && priorRecord && (priorRecord.status === "completed" || priorRecord.status === "failed")) return;

    await this.approvalCoordinator.apply(decision);

    const stepRecord = instance.steps.find((step) => step.stepId === decision.stepId);
    const definition = this.definitions.get(workflowId);
    const stepDef = definition?.steps.find((step) => step.id === decision.stepId);
    const recoverableGate = instance.state === "AWAITING_APPROVAL" && stepRecord?.status === "pending";
    if ((stepRecord?.status === "running" || recoverableGate) && stepDef?.kind === "gate") {
      if (decision.outcome === "approved") {
        instance.context.outputs[decision.stepId] = {
          outcome: decision.outcome,
          approvalId: decision.approvalId ?? `legacy-${decision.workflowId}-${decision.stepId}`,
          approver: decision.approver,
          note: decision.note,
          decidedAt: decision.decidedAt,
          disposition: decision.disposition ?? "resume",
          ...(decision.scope === undefined ? {} : { scope: decision.scope }),
          ...(decision.authorityBinding === undefined ? {} : { authorityBinding: decision.authorityBinding as unknown as Json }),
          ...(decision.sceneDecisions === undefined ? {} : { sceneDecisions: decision.sceneDecisions }),
          ...(decision.finalMediaArtifactId === undefined ? {} : { finalMediaArtifactId: decision.finalMediaArtifactId }),
          ...(decision.finalTechnicalQAReportId === undefined ? {} : { finalTechnicalQAReportId: decision.finalTechnicalQAReportId }),
          ...(decision.finalProductReviewId === undefined ? {} : { finalProductReviewId: decision.finalProductReviewId }),
        };
        stepRecord.status = "completed";
        stepRecord.finishedAt = decision.decidedAt;
        instance.state = decision.disposition === "pause" ? "PAUSED" : "RUNNING";
        this.advance(instance, stepDef, decision.stepId);
      } else if (decision.outcome === "iteration_requested") {
        // Owner iteration request: the gate did not pass; production must stop
        // and route to the durable revision-required business state.
        stepRecord.status = "failed";
        stepRecord.finishedAt = decision.decidedAt;
        instance.ready = instance.ready.filter((id) => id !== decision.stepId);
        instance.state = "REVISION_REQUIRED";
        instance.context.data.preProductionOwnerDecision = {
          decision: "REQUEST_ITERATION",
          stepId: decision.stepId,
          rationale: decision.note,
          decidedAt: decision.decidedAt,
        };
      } else if (decision.outcome === "policy_bypass") {
        // Policy-based gate bypass (owner-configured human-gate disabled for
        // NEW routing decisions only). This is NOT a human approval: the
        // durable record explicitly states gateRequired=false and carries the
        // governance snapshot that authorized the bypass.
        instance.context.outputs[decision.stepId] = {
          outcome: "policy_bypass",
          gateRequired: false,
          gateBypassedByPolicy: true,
          gatePolicy: decision.gatePolicy ?? null,
          note: decision.note,
          decidedAt: decision.decidedAt,
          ...(decision.sceneDecisions === undefined ? {} : { sceneDecisions: decision.sceneDecisions }),
        };
        stepRecord.status = "completed";
        stepRecord.finishedAt = decision.decidedAt;
        instance.state = "RUNNING";
        this.advance(instance, stepDef, decision.stepId);
      } else {
        stepRecord.status = "failed";
        stepRecord.finishedAt = decision.decidedAt;
        instance.state = "FAILED";
      }
      instance.updatedAt = decision.decidedAt;
      await this.checkpointCoordinator.checkpoint(instance);
      await this.persist(instance);
      if ((decision.outcome === "approved" && decision.disposition !== "pause") || decision.outcome === "policy_bypass") void this.executeLoop(instance);
    }

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
      if (instance.state !== "RUNNING") break;
      this.normalizeCompletedFrontier(instance);
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

  /** Advance through already-completed imported steps without re-executing them. */
  private normalizeCompletedFrontier(instance: WorkflowInstance): void {
    const definition = this.definitions.get(instance.workflowId);
    if (!definition) return;
    const nextReady: StepId[] = [];
    for (const stepId of instance.ready) {
      const record = instance.steps.find((step) => step.stepId === stepId);
      const stepDef = definition.steps.find((step) => step.id === stepId);
      if (record?.status === "completed" && stepDef?.next !== undefined) {
        const next = Array.isArray(stepDef.next) ? stepDef.next : [stepDef.next];
        nextReady.push(...next);
      } else if (record?.status !== "completed") {
        nextReady.push(stepId);
      }
    }
    instance.ready = [...new Set(nextReady)];
  }

  private async executeStep(instance: WorkflowInstance, stepId: StepId): Promise<void> {
    const stepRecord = instance.steps.find((s) => s.stepId === stepId);
    if (!stepRecord || (stepRecord.status !== "pending" && stepRecord.status !== "failed")) return;

    const definition = this.definitions.get(instance.workflowId);
    const stepDef = definition?.steps.find((s) => s.id === stepId);

    // Canonical governed transition boundary. A human-required decision never
    // falls through to ordinary execution: gates enter the approval wait state;
    // all other callers fail closed.
    if (this.policyEnforcer && stepDef) {
      const policy = await this.policyEnforcer.evaluate({
        workflowId: instance.workflowId,
        correlationId: instance.context.correlationId,
        sourceStage: typeof instance.context.data.currentStage === "string" ? instance.context.data.currentStage : "workflow",
        targetStage: stepId,
        ruleId: `workflow-transition-${stepId}`,
        requiredEvidence: ["workflow-definition", "correlation-id"],
        artifactIds: [],
        humanGate: stepDef.kind === "gate",
      });
      if (policy.decision === "DENY") {
        stepRecord.status = "failed";
        stepRecord.finishedAt = new Date().toISOString();
        instance.state = "FAILED";
        await this.persist(instance);
        return;
      }
      if (policy.decision === "HUMAN_GATE_REQUIRED") {
        if (stepDef.kind !== "gate") {
          stepRecord.status = "failed";
          stepRecord.finishedAt = new Date().toISOString();
          instance.state = "FAILED";
          await this.persist(instance);
          return;
        }
        stepRecord.status = "running";
        instance.state = "AWAITING_APPROVAL";
        await this.approvalCoordinator.request(instance.workflowId, stepDef.id, stepDef.approver, stepDef.reason);
        await this.checkpointCoordinator.checkpoint(instance);
        await this.persist(instance);
        return;
      }
      instance.context.data.currentStage = stepId;
    }

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
          if (stepDef?.kind === "gate") {
            await this.approvalCoordinator.request(instance.workflowId, stepDef.id, stepDef.approver, stepDef.reason);
          }
          await this.checkpointCoordinator.checkpoint(instance);
          await this.persist(instance);
          return;
        }
        if (outcome.status === "failed") {
          stepRecord.status = "failed";
          stepRecord.finishedAt = new Date().toISOString();
          instance.ready = instance.ready.filter((id) => id !== stepId);
          instance.state = "FAILED";
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
        if (outcome.reviewBusinessStatus !== undefined) {
          if (outcome.artifact?.kind !== "review_report" || outcome.artifact.status !== "completed") throw new Error("VALID_REVIEW_ARTIFACT_REQUIRED_BEFORE_BUSINESS_BRANCH");
          instance.context.data.reviewBusinessOutcome = {
            status: outcome.reviewBusinessStatus,
            reviewArtifactId: outcome.artifact.artifactId,
            reviewExecutionId: outcome.reviewExecutionId ?? null,
          };
          if (outcome.reviewBusinessStatus === "changes_requested" || outcome.reviewBusinessStatus === "blocked") {
            instance.ready = instance.ready.filter((id) => id !== stepId);
            instance.state = outcome.reviewBusinessStatus === "changes_requested" ? "REVISION_REQUIRED" : "BUSINESS_BLOCKED";
          } else {
            this.advance(instance, stepDef, stepId);
          }
        } else {
          this.advance(instance, stepDef, stepId);
        }
      }

      await this.auditTrail.append({
        workflowId: instance.workflowId,
        kind: "step_completed",
        stepId,
        detail: { output: instance.context.outputs[stepId] },
        at: stepRecord.finishedAt,
      });

      // Bounded execution: an owner-authorized stopAfterStepId halts the run
      // after this step completes successfully. This is a successful bounded
      // pause, not a failure: the ready frontier is preserved so a future
      // resume continues with the next step. Fires only on fresh completion
      // within this run, never when merely passing an already-completed step.
      const boundedStop = readBoundedStopAfter(instance, stepId);
      if (boundedStop !== null && instance.state === "RUNNING") {
        instance.context.data.boundedStop = {
          stopAfterStepId: stepId,
          reason: boundedStop.reason,
          authorization: boundedStop.authorization,
          recoveryExecutionId: boundedStop.recoveryExecutionId,
          stoppedAt: new Date().toISOString(),
        };
        instance.state = this.stateMachine.next(instance.state, "bounded_stop");
        instance.updatedAt = new Date().toISOString();
        await this.auditTrail.append({
          workflowId: instance.workflowId,
          kind: "bounded_stop",
          stepId,
          detail: { reason: boundedStop.reason },
          at: instance.updatedAt,
        });
      }

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
      instance.ready = instance.ready.filter((id) => id !== stepId);
      instance.state = "FAILED";

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
