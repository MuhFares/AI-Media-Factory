/**
 * PostgreSQL adapter for the workflow PersistencePort.
 *
 * Implements durable, idempotent persistence for workflow instances, steps,
 * checkpoints, artifacts (+ lineage), capability executions, execution evidence
 * and decisions. Agents never see this layer — they stay behind the Runtime /
 * Workflow Engine boundary.
 */

import type pg from "pg";
import type { Uuid, CollaborationArtifact, AgentArtifactStatus } from "@ai-media-factory/shared";
import type {
  PersistencePort,
  CapabilityExecutionRecord,
  ExecutionEvidenceRecord,
  DecisionRecord,
  ExecutionProvenanceRecord,
} from "@ai-media-factory/workflow-engine";
import type { ExecutionLifecycleEvent, ExecutionFailureFallbackEvent } from "@ai-media-factory/workflow-engine";
import type { WorkflowInstance, StepRecord } from "@ai-media-factory/workflow-engine";
import type { WorkflowCheckpoint } from "@ai-media-factory/workflow-engine";

const JSON_PARSE = (v: unknown): any => {
  if (v === null || v === undefined) return v;
  if (typeof v === "string") return JSON.parse(v);
  return v;
};

export class PostgresPersistence implements PersistencePort {
  private closed = false;
  constructor(private readonly pool: pg.Pool) {}

  // -- Workflow instance + steps ----------------------------------------------
  async saveWorkflow(instance: WorkflowInstance): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO workflow_instances
           (workflow_id, definition_id, definition_version, state, context, ready, last_checkpoint_ref, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (workflow_id) DO UPDATE SET
           state=$4, context=$5, ready=$6, last_checkpoint_ref=$7, updated_at=$9`,
        [
          instance.workflowId,
          instance.definitionId,
          instance.definitionVersion,
          instance.state,
          JSON.stringify(instance.context),
          JSON.stringify(instance.ready),
          instance.lastCheckpointRef,
          instance.createdAt,
          instance.updatedAt,
        ]
      );
      for (const s of instance.steps) {
        await client.query(
          `INSERT INTO workflow_steps (workflow_id, step_id, status, attempts, started_at, finished_at)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (workflow_id, step_id) DO UPDATE SET
             status=$3, attempts=$4, started_at=$5, finished_at=$6`,
          [instance.workflowId, s.stepId, s.status, s.attempts, s.startedAt, s.finishedAt]
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  async loadWorkflow(workflowId: Uuid): Promise<WorkflowInstance | null> {
    const inst = await this.pool.query(
      `SELECT definition_id, definition_version, state, context, ready, last_checkpoint_ref, created_at, updated_at
       FROM workflow_instances WHERE workflow_id = $1`,
      [workflowId]
    );
    if (inst.rowCount === 0) return null;
    const r = inst.rows[0];
    const stepsRes = await this.pool.query(
      `SELECT step_id, status, attempts, started_at, finished_at
       FROM workflow_steps WHERE workflow_id = $1 ORDER BY step_id`,
      [workflowId]
    );
    const steps: StepRecord[] = stepsRes.rows.map((row: any) => ({
      stepId: row.step_id,
      status: row.status,
      attempts: row.attempts,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
    }));
    return {
      workflowId,
      definitionId: r.definition_id,
      definitionVersion: r.definition_version,
      state: r.state,
      context: JSON_PARSE(r.context),
      steps,
      ready: JSON_PARSE(r.ready),
      lastCheckpointRef: r.last_checkpoint_ref,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  // -- Checkpoints -------------------------------------------------------------
  async saveCheckpoint(checkpoint: WorkflowCheckpoint): Promise<void> {
    await this.pool.query(
      `INSERT INTO workflow_checkpoints
         (workflow_id, state, completed_steps, context_snapshot_ref, last_event_offset, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        checkpoint.workflowId,
        checkpoint.state,
        JSON.stringify(checkpoint.completedSteps),
        checkpoint.contextSnapshotRef,
        checkpoint.lastEventOffset,
        checkpoint.createdAt,
      ]
    );
  }

  async loadLatestCheckpoint(workflowId: Uuid): Promise<WorkflowCheckpoint | null> {
    const res = await this.pool.query(
      `SELECT state, completed_steps, context_snapshot_ref, last_event_offset, created_at
       FROM workflow_checkpoints WHERE workflow_id = $1 ORDER BY id DESC LIMIT 1`,
      [workflowId]
    );
    if (res.rowCount === 0) return null;
    const r = res.rows[0];
    return {
      workflowId,
      state: r.state,
      completedSteps: JSON_PARSE(r.completed_steps),
      contextSnapshotRef: r.context_snapshot_ref,
      lastEventOffset: r.last_event_offset,
      createdAt: r.created_at,
    };
  }

  // -- Artifacts + lineage -------------------------------------------------------
  async saveArtifact(artifact: CollaborationArtifact): Promise<void> {
    await this.pool.query(
      `INSERT INTO artifacts
         (artifact_id, workflow_id, kind, producer_agent, correlation_id, status, payload,
          content_type, schema_version, created_at, parent_artifact_id, parent_artifact_kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (artifact_id) DO NOTHING`,
      [
        artifact.artifactId,
        artifact.workflowId,
        artifact.kind,
        artifact.producerAgent,
        artifact.correlationId,
        artifact.status,
        JSON.stringify(artifact.payload),
        artifact.contentType,
        artifact.schemaVersion,
        artifact.createdAt,
        artifact.parentArtifact?.artifactId ?? null,
        artifact.parentArtifact?.kind ?? null,
      ]
    );
  }

  async listArtifacts(workflowId: Uuid): Promise<CollaborationArtifact[]> {
    const res = await this.pool.query(
      `SELECT artifact_id, kind, producer_agent, correlation_id, status, payload,
              content_type, schema_version, created_at, parent_artifact_id, parent_artifact_kind
       FROM artifacts WHERE workflow_id = $1 ORDER BY created_at`,
      [workflowId]
    );
    return res.rows.map((row: any): CollaborationArtifact => this.artifactRow(row, workflowId));
  }

  /** Slice 7: direct canonical lookup for inspection delivery (read-only, no mutation). */
  async getArtifactById(artifactId: string): Promise<CollaborationArtifact | null> {
    const res = await this.pool.query(
      `SELECT artifact_id, workflow_id, kind, producer_agent, correlation_id, status, payload,
              content_type, schema_version, created_at, parent_artifact_id, parent_artifact_kind
       FROM artifacts WHERE artifact_id = $1`,
      [artifactId]
    );
    if (res.rowCount === 0) return null;
    return this.artifactRow(res.rows[0], String(res.rows[0].workflow_id));
  }

  private artifactRow(row: any, workflowId: string): CollaborationArtifact {
    const base: CollaborationArtifact = {
      artifactId: row.artifact_id,
      kind: row.kind,
      producerAgent: row.producer_agent,
      workflowId,
      correlationId: row.correlation_id,
      status: row.status as AgentArtifactStatus,
      payload: JSON_PARSE(row.payload),
      contentType: row.content_type,
      schemaVersion: row.schema_version,
      createdAt: row.created_at,
    };
    if (row.parent_artifact_id === null) return base;
    return {
      ...base,
      parentArtifact: { artifactId: row.parent_artifact_id, kind: row.parent_artifact_kind },
    };
  }

  // -- Capability executions -----------------------------------------------------
  async saveCapabilityExecution(record: CapabilityExecutionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO capability_executions
         (result_id, workflow_id, correlation_id, capability_id, agent_id, status, evidence_id,
          idempotency_key, executed_at, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [
        record.resultId,
        record.workflowId,
        record.correlationId,
        record.capabilityId,
        record.agentId,
        record.status,
        record.evidenceId,
        record.idempotencyKey,
        record.executedAt,
        JSON.stringify(record.payload),
      ]
    );
  }

  async listCapabilityExecutions(workflowId: Uuid): Promise<CapabilityExecutionRecord[]> {
    const res = await this.pool.query(
      `SELECT result_id, correlation_id, capability_id, agent_id, status, evidence_id,
              idempotency_key, executed_at, payload
       FROM capability_executions WHERE workflow_id = $1 ORDER BY executed_at`,
      [workflowId]
    );
    return res.rows.map((row: any) => ({
      resultId: row.result_id,
      workflowId,
      correlationId: row.correlation_id,
      capabilityId: row.capability_id,
      agentId: row.agent_id,
      status: row.status,
      evidenceId: row.evidence_id,
      idempotencyKey: row.idempotency_key,
      executedAt: row.executed_at,
      payload: JSON_PARSE(row.payload),
    }));
  }

  // -- Execution evidence ---------------------------------------------------------
  async saveExecutionEvidence(record: ExecutionEvidenceRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO execution_evidence
         (evidence_id, workflow_id, correlation_id, capability_id, agent_id, executed_at,
          succeeded, idempotency_key, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
      [
        record.evidenceId,
        record.workflowId,
        record.correlationId,
        record.capabilityId,
        record.agentId,
        record.executedAt,
        record.succeeded,
        record.idempotencyKey,
        JSON.stringify(record.payload),
      ]
    );
  }

  async listExecutionEvidence(workflowId: Uuid): Promise<ExecutionEvidenceRecord[]> {
    const res = await this.pool.query(
      `SELECT evidence_id, correlation_id, capability_id, agent_id, executed_at, succeeded,
              idempotency_key, payload
       FROM execution_evidence WHERE workflow_id = $1 ORDER BY executed_at`,
      [workflowId]
    );
    return res.rows.map((row: any) => ({
      evidenceId: row.evidence_id,
      workflowId,
      correlationId: row.correlation_id,
      capabilityId: row.capability_id,
      agentId: row.agent_id,
      executedAt: row.executed_at,
      succeeded: row.succeeded,
      idempotencyKey: row.idempotency_key,
      payload: JSON_PARSE(row.payload),
    }));
  }

  async saveExecutionProvenance(record: ExecutionProvenanceRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO execution_provenance
       (execution_id, workflow_id, correlation_id, agent_id, stage, capability, provider, model, runtime,
         prompt_version, configuration_fingerprint, started_at, completed_at, latency_ms, status, usage,
         cost_kind, cost, currency, artifact_ids, parent_execution_ids, attempt_number, provider_request_id,
         provider_job_id, error_classification, configuration, failure_metadata, strategic_snapshot_id, provider_model_snapshot_id, estimated_cost, actual_calculable_cost, provider_billed_cost, cost_evidence)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33)
        ON CONFLICT (execution_id) DO UPDATE SET
         completed_at = EXCLUDED.completed_at,
         latency_ms = EXCLUDED.latency_ms,
         status = EXCLUDED.status,
         usage = EXCLUDED.usage,
         cost_kind = EXCLUDED.cost_kind,
         cost = EXCLUDED.cost,
         currency = EXCLUDED.currency,
         artifact_ids = EXCLUDED.artifact_ids,
         provider_request_id = EXCLUDED.provider_request_id,
         provider_job_id = EXCLUDED.provider_job_id,
         error_classification = EXCLUDED.error_classification,
         configuration = EXCLUDED.configuration,
         failure_metadata = EXCLUDED.failure_metadata,
         strategic_snapshot_id = COALESCE(execution_provenance.strategic_snapshot_id, EXCLUDED.strategic_snapshot_id),
         provider_model_snapshot_id = COALESCE(execution_provenance.provider_model_snapshot_id, EXCLUDED.provider_model_snapshot_id),
         estimated_cost = COALESCE(execution_provenance.estimated_cost, EXCLUDED.estimated_cost),
         actual_calculable_cost = COALESCE(execution_provenance.actual_calculable_cost, EXCLUDED.actual_calculable_cost),
         provider_billed_cost = COALESCE(execution_provenance.provider_billed_cost, EXCLUDED.provider_billed_cost),
         cost_evidence = COALESCE(execution_provenance.cost_evidence, EXCLUDED.cost_evidence)`,
      [record.executionId, record.workflowId, record.correlationId, record.agentId, record.stage, record.capability,
        record.provider, record.model, record.runtime, record.promptVersion, record.configurationFingerprint,
        record.startedAt, record.completedAt, record.latencyMs, record.status,
        record.usage === null ? null : JSON.stringify(record.usage), record.costKind, record.cost, record.currency,
        JSON.stringify(record.artifactIds), JSON.stringify(record.parentExecutionIds), record.attemptNumber,
        record.providerRequestId, record.providerJobId, record.errorClassification,
        record.configuration == null ? null : JSON.stringify(record.configuration),
        record.failureMetadata == null ? null : JSON.stringify(record.failureMetadata),
        record.strategicSnapshotId ?? null, record.providerModelSnapshotId ?? null, record.estimatedCost ?? null,
        record.actualCalculableCost ?? null, record.providerBilledCost ?? null,
        record.costEvidence == null ? null : JSON.stringify(record.costEvidence)]
    );
  }

  async listExecutionProvenance(workflowId: Uuid): Promise<ExecutionProvenanceRecord[]> {
    const res = await this.pool.query(
      `SELECT * FROM execution_provenance WHERE workflow_id = $1 ORDER BY started_at, execution_id`, [workflowId]
    );
    return res.rows.map((row: any) => ({
      executionId: row.execution_id, workflowId, correlationId: row.correlation_id, agentId: row.agent_id, stage: row.stage,
      capability: row.capability, provider: row.provider, model: row.model, runtime: row.runtime,
      promptVersion: row.prompt_version, configurationFingerprint: row.configuration_fingerprint,
      startedAt: row.started_at, completedAt: row.completed_at, latencyMs: Number(row.latency_ms), status: row.status,
      usage: row.usage === null ? null : JSON_PARSE(row.usage), costKind: row.cost_kind,
      cost: row.cost === null ? null : Number(row.cost), currency: row.currency,
      artifactIds: JSON_PARSE(row.artifact_ids), parentExecutionIds: JSON_PARSE(row.parent_execution_ids),
      attemptNumber: row.attempt_number, providerRequestId: row.provider_request_id, providerJobId: row.provider_job_id,
      errorClassification: row.error_classification,
      configuration: row.configuration === null ? null : JSON_PARSE(row.configuration),
      strategicSnapshotId: row.strategic_snapshot_id ?? null,
      providerModelSnapshotId: row.provider_model_snapshot_id ?? null,
      estimatedCost: row.estimated_cost === null ? null : Number(row.estimated_cost),
      actualCalculableCost: row.actual_calculable_cost === null ? null : Number(row.actual_calculable_cost),
      providerBilledCost: row.provider_billed_cost === null ? null : Number(row.provider_billed_cost),
      costEvidence: row.cost_evidence === null ? null : JSON_PARSE(row.cost_evidence),
      failureMetadata: row.failure_metadata === null ? null : JSON_PARSE(row.failure_metadata),
    }));
  }

  /** Atomically move only a pre-transport execution into the provider boundary. */
  async claimReadyExecutionProvenance(executionId: string, details: { maxTokens?: number; callLeg?: string; reservationId?: string; idempotencyKey?: string } = {}): Promise<boolean> {
    const now = new Date().toISOString();
    const res = await this.pool.query(
      `UPDATE execution_provenance
       SET completed_at = $3::text,
           latency_ms = GREATEST(latency_ms, 0),
           configuration = jsonb_set(
             jsonb_set(COALESCE(configuration, '{}'::jsonb), '{lifecycleState}', '"PROVIDER_SUBMISSION_INTENT"'::jsonb, true),
             '{lifecycleDetails}', jsonb_build_object(
               'providerSubmissionStarted', true,
               'maxTokens', $2::int,
               'callLeg', $4::text,
               'reservationId', $5::text,
               'idempotencyKey', $6::text
             ), true)
       WHERE execution_id = $1
         AND configuration->>'lifecycleState' = 'READY_FOR_SUBMISSION'
       RETURNING execution_id`,
      [executionId, Number.isInteger(details.maxTokens) ? details.maxTokens : null, now, details.callLeg ?? null, details.reservationId ?? null, details.idempotencyKey ?? null],
    );
    if ((res.rowCount ?? 0) === 1) {
      const current = await this.pool.query(`SELECT workflow_id, stage, attempt_number, provider, model FROM execution_provenance WHERE execution_id = $1`, [executionId]);
      const row = current.rows[0];
      await this.appendExecutionLifecycleEvent({ executionId, workflowId: row.workflow_id, stage: row.stage, state: "PROVIDER_SUBMISSION_INTENT", occurredAt: now, attemptNumber: row.attempt_number, metadata: { provider: row.provider, requestedModel: row.model, maxTokens: Number.isInteger(details.maxTokens) ? details.maxTokens : null, callLeg: details.callLeg ?? null, reservationId: details.reservationId ?? null, idempotencyKey: details.idempotencyKey ?? null } });
    }
    return (res.rowCount ?? 0) === 1;
  }

  async appendExecutionLifecycleEvent(event: ExecutionLifecycleEvent): Promise<void> {
    await this.pool.query(`INSERT INTO execution_lifecycle_events (execution_id, workflow_id, stage, state, occurred_at, attempt_number, metadata) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [event.executionId, event.workflowId, event.stage, event.state, event.occurredAt, event.attemptNumber, JSON.stringify(event.metadata)]);
  }

  async listExecutionLifecycleEvents(executionId: string): Promise<ExecutionLifecycleEvent[]> {
    const result = await this.pool.query(`SELECT execution_id, workflow_id, stage, state, occurred_at, attempt_number, metadata FROM execution_lifecycle_events WHERE execution_id=$1 ORDER BY event_id`, [executionId]);
    return result.rows.map((row: any) => ({ executionId: row.execution_id, workflowId: row.workflow_id, stage: row.stage, state: row.state, occurredAt: row.occurred_at, attemptNumber: row.attempt_number, metadata: JSON_PARSE(row.metadata) }));
  }

  async appendExecutionFailureFallbackEvent(event: ExecutionFailureFallbackEvent): Promise<void> {
    await this.pool.query(
      `INSERT INTO execution_failure_fallback_events (execution_id, workflow_id, stage, attempt_number, occurred_at, metadata)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (execution_id, attempt_number, stage) DO NOTHING`,
      [event.executionId, event.workflowId, event.stage, event.attemptNumber, event.occurredAt, JSON.stringify(event.metadata)],
    );
  }

  async listExecutionFailureFallbackEvents(executionId: string): Promise<ExecutionFailureFallbackEvent[]> {
    const result = await this.pool.query(
      `SELECT execution_id, workflow_id, stage, attempt_number, occurred_at, metadata
       FROM execution_failure_fallback_events WHERE execution_id=$1 ORDER BY event_id`, [executionId],
    );
    return result.rows.map((row: any) => ({ executionId: row.execution_id, workflowId: row.workflow_id, stage: row.stage, attemptNumber: row.attempt_number, occurredAt: row.occurred_at, metadata: JSON_PARSE(row.metadata) }));
  }

  // -- Decisions / directives / business cycle -------------------------------------
  async saveDecision(record: DecisionRecord): Promise<void> {
    await this.pool.query(
      `INSERT INTO decisions (decision_id, kind, workflow_id, correlation_id, cycle, payload, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (decision_id) DO NOTHING`,
      [
        record.decisionId,
        record.kind,
        record.workflowId,
        record.correlationId,
        record.cycle,
        JSON.stringify(record.payload),
        record.createdAt,
      ]
    );
  }

  async listDecisions(workflowId: Uuid): Promise<DecisionRecord[]> {
    const res = await this.pool.query(
      `SELECT decision_id, kind, correlation_id, cycle, payload, created_at
       FROM decisions WHERE workflow_id = $1 ORDER BY created_at`,
      [workflowId]
    );
    return res.rows.map((row: any) => ({
      decisionId: row.decision_id,
      kind: row.kind,
      workflowId,
      correlationId: row.correlation_id,
      cycle: row.cycle,
      payload: JSON_PARSE(row.payload),
      createdAt: row.created_at,
    }));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.pool.end();
  }
}
