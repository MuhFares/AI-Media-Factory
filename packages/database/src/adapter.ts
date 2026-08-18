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
} from "@ai-media-factory/workflow-engine";
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
    return res.rows.map((row: any): CollaborationArtifact => {
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
    });
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