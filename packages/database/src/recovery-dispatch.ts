import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { Json, Uuid } from "@ai-media-factory/shared";
import { rewindWorkflow } from "@ai-media-factory/workflow-engine";
import type { PostgresPersistence } from "./adapter.js";
import { PostgresQueue } from "./queue.js";

export interface RecoveryDispatchInput {
  readonly authorizationKey: string;
  readonly workflowId: Uuid;
  readonly recoveryOfExecutionId: string;
  readonly originalExecutionId: string;
  readonly recoveryReason: string;
  readonly recoveryAuthorization: "OWNER_APPROVED";
  readonly targetStepId: string;
  readonly preserveCompletedStepIds: readonly string[];
  readonly requiredArtifactsByStep: Readonly<Record<string, string>>;
  readonly commandId?: string;
  readonly controlAgentOverrides?: Record<string, Json>;
  /**
   * Optional owner-authorized bounded stop: after this step completes freshly
   * within the resumed run, the workflow engine halts (bounded pause) instead
   * of advancing. Generic mechanism; the engine reads it from context data.
   */
  readonly stopAfterStepId?: string;
}

export interface RecoveryDispatchResult {
  readonly created: boolean;
  readonly recoveryExecutionId: string;
  readonly jobId: number;
}

/**
 * Durable recovery dispatch.  This class never creates an engine or a
 * provider executor: its last side effect is the durable queue insert.  The
 * persistent WorkflowWorker is consequently the only provider transport path.
 */
export class PostgresRecoveryDispatcher {
  constructor(private readonly pool: pg.Pool, private readonly persistence: PostgresPersistence) {}

  async dispatch(input: RecoveryDispatchInput): Promise<RecoveryDispatchResult> {
    const queue = new PostgresQueue(this.pool);
    const existing = await this.pool.query(
      `SELECT recovery_execution_id, job_id FROM workflow_recovery_dispatches WHERE authorization_key = $1`,
      [input.authorizationKey],
    );
    if (existing.rowCount) return { created: false, recoveryExecutionId: existing.rows[0].recovery_execution_id, jobId: Number(existing.rows[0].job_id) };

    const submission = await queue.loadSubmissionByWorkflow(input.workflowId);
    if (!submission) throw new Error("RECOVERY_WORKFLOW_SUBMISSION_NOT_FOUND");
    const executions = await this.persistence.listExecutionProvenance(input.workflowId);
    if (!executions.some((record) => record.executionId === input.recoveryOfExecutionId)) throw new Error("RECOVERY_OF_EXECUTION_NOT_FOUND");
    if (!executions.some((record) => record.executionId === input.originalExecutionId)) throw new Error("RECOVERY_ORIGINAL_EXECUTION_NOT_FOUND");

    const recoveryExecutionId = randomUUID();
    const now = new Date().toISOString();
    const insert = await this.pool.query(
      `INSERT INTO workflow_recovery_dispatches
       (authorization_key, workflow_id, submission_key, recovery_execution_id, recovery_of_execution_id, original_execution_id, recovery_reason, authorization_status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (authorization_key) DO NOTHING RETURNING authorization_key`,
      [input.authorizationKey, input.workflowId, submission.submissionKey, recoveryExecutionId, input.recoveryOfExecutionId, input.originalExecutionId, input.recoveryReason, input.recoveryAuthorization, now],
    );
    if (!insert.rowCount) return this.dispatch(input);

    const definition = submission.definition;
    const targetStep = definition.steps.find((step) => step.id === input.targetStepId);
    if (!targetStep || targetStep.kind !== "agent") throw new Error("RECOVERY_TARGET_MUST_BE_AN_AGENT_STEP");
    await rewindWorkflow(this.persistence, definition, {
      workflowId: input.workflowId, targetStepId: input.targetStepId,
      requiredArtifactsByStep: input.requiredArtifactsByStep,
      preserveCompletedStepIds: input.preserveCompletedStepIds,
      rewindStepIds: definition.steps.map((step) => step.id).filter((id) => !input.preserveCompletedStepIds.includes(id)),
      reason: input.recoveryReason,
    });
    const workflow = await this.persistence.loadWorkflow(input.workflowId);
    if (!workflow) throw new Error("RECOVERY_WORKFLOW_NOT_FOUND_AFTER_REWIND");
    const recoveryExecution = {
      recoveryExecutionId,
      recoveryOfExecutionId: input.recoveryOfExecutionId,
      originalExecutionId: input.originalExecutionId,
      recoveryReason: input.recoveryReason,
      recoveryAuthorization: input.recoveryAuthorization,
      reuseCanonicalInputs: true,
      replayUpstreamStages: false,
      ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
    };
    await this.persistence.saveWorkflow({ ...workflow, context: { ...workflow.context, data: { ...workflow.context.data, recoveryExecution, ...(input.controlAgentOverrides === undefined ? {} : { controlAgentOverrides: input.controlAgentOverrides }), ...(input.stopAfterStepId === undefined ? {} : { boundedExecution: { stopAfterStepId: input.stopAfterStepId, reason: input.recoveryReason, authorization: input.recoveryAuthorization, recoveryExecutionId } }) } }, updatedAt: now });
    await this.persistence.saveExecutionProvenance({
      executionId: recoveryExecutionId, workflowId: input.workflowId, correlationId: workflow.context.correlationId ?? null,
      agentId: targetStep.agent, stage: input.targetStepId, capability: "agent.execute", provider: null,
      model: null, runtime: null, promptVersion: null, configurationFingerprint: null, startedAt: now, completedAt: now,
      latencyMs: 0, status: "blocked", usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: [],
      parentExecutionIds: [input.recoveryOfExecutionId, input.originalExecutionId], attemptNumber: 1, providerRequestId: null,
      providerJobId: null, errorClassification: null,
      configuration: { recoveryExecution, lifecycleState: "READY_FOR_SUBMISSION", providerSubmissionStarted: false, inputArtifactIds: [] },
    });
    const jobId = await queue.enqueue(input.workflowId, submission.submissionKey);
    await this.pool.query(`UPDATE workflow_recovery_dispatches SET job_id = $2 WHERE authorization_key = $1`, [input.authorizationKey, jobId]);
    return { created: true, recoveryExecutionId, jobId };
  }
}
