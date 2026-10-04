import { createHash } from "node:crypto";
import type pg from "pg";

export const RESEARCH_TERMINAL_RECONCILIATION_MODE = "RESEARCH_TERMINAL_RECONCILIATION" as const;
export const RESEARCH_TERMINAL_SEMANTIC_OUTCOME = "NO_PRODUCTION_CANDIDATE" as const;
export const RESEARCH_TERMINAL_EVIDENCE_STATUS = "INSUFFICIENT_EVIDENCE_WITH_PARTIAL_PERSISTENCE" as const;

export interface ResearchTerminalReconciliationInput {
  readonly projectId: string;
  readonly contentId: string;
  readonly workflowId: string;
  readonly correlationId: string;
  readonly sourceRecoveryExecutionId: string;
  readonly sourceJobId: number;
  readonly synthesisResponseId: string;
  readonly synthesisFingerprint: string;
  readonly expectedSemanticOutcome: typeof RESEARCH_TERMINAL_SEMANTIC_OUTCOME;
  readonly reason: string;
  readonly ownerAuthorization: string;
  readonly ownerActor: string;
  readonly idempotencyIdentity: string;
  readonly identityCollisionRemediationRef: string;
}

export interface ResearchRetrievalPersistenceState {
  readonly ordinal: number;
  readonly idempotencyKey: string;
  readonly resultEventAt: string;
  readonly state: "AVAILABLE" | "TRANSPORT_SUCCEEDED_PAYLOAD_UNAVAILABLE";
  readonly resultId: string | null;
  readonly evidenceId: string | null;
}

export interface ResearchTerminalReconciliationResult {
  readonly outcome: "APPLIED" | "ALREADY_RECONCILED";
  readonly mutated: boolean;
  readonly artifactId: string;
  readonly auditEventId: string;
  readonly workflowState: "BUSINESS_BLOCKED";
  readonly researchStepState: "COMPLETED";
  readonly semanticOutcome: typeof RESEARCH_TERMINAL_SEMANTIC_OUTCOME;
  readonly evidenceStatus: typeof RESEARCH_TERMINAL_EVIDENCE_STATUS;
  readonly retrievals: readonly ResearchRetrievalPersistenceState[];
}

type JsonRecord = Record<string, unknown>;

function object(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function required(value: string, field: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`RESEARCH_TERMINAL_RECONCILIATION_REQUIRED:${field}`);
  return trimmed;
}

function digest(...parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

function parseSynthesis(raw: unknown): JsonRecord {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("RESEARCH_TERMINAL_RECONCILIATION_SYNTHESIS_PAYLOAD_MISSING");
  }
  try {
    return object(JSON.parse(raw));
  } catch {
    throw new Error("RESEARCH_TERMINAL_RECONCILIATION_SYNTHESIS_PAYLOAD_INVALID");
  }
}

export function assertTerminalNonAdvancingSynthesis(payload: unknown): asserts payload is JsonRecord {
  const synthesis = object(payload);
  if (synthesis.status !== "insufficient_evidence") {
    throw new Error("RESEARCH_TERMINAL_RECONCILIATION_SYNTHESIS_NOT_TERMINAL_NON_ADVANCING");
  }
  const candidates = Array.isArray(synthesis.candidateStories) ? synthesis.candidateStories : null;
  if (candidates === null || candidates.length !== 0) {
    throw new Error("RESEARCH_TERMINAL_RECONCILIATION_ELIGIBLE_CANDIDATE_PRESENT");
  }
  const sources = Array.isArray(synthesis.sources) ? synthesis.sources : null;
  if (sources === null || sources.length !== 0) {
    throw new Error("RESEARCH_TERMINAL_RECONCILIATION_SYNTHESIS_SOURCE_CONFLICT");
  }
  if (typeof synthesis.summary !== "string" || synthesis.summary.trim() === "") {
    throw new Error("RESEARCH_TERMINAL_RECONCILIATION_SYNTHESIS_SUMMARY_MISSING");
  }
}

function artifactIdentity(input: ResearchTerminalReconciliationInput): string {
  return `art-${input.workflowId}-research-terminal-${digest(input.idempotencyIdentity).slice(0, 16)}`;
}

function auditIdentity(input: ResearchTerminalReconciliationInput): string {
  return `audit-research-terminal-${digest(input.idempotencyIdentity).slice(0, 24)}`;
}

function replayResult(row: JsonRecord, auditEventId: string): ResearchTerminalReconciliationResult {
  const payload = object(row.payload);
  const reconciliation = object(payload.terminalReconciliation);
  const retrievals = Array.isArray(reconciliation.retrievals)
    ? reconciliation.retrievals as unknown as ResearchRetrievalPersistenceState[] : [];
  return {
    outcome: "ALREADY_RECONCILED",
    mutated: false,
    artifactId: String(row.artifact_id),
    auditEventId,
    workflowState: "BUSINESS_BLOCKED",
    researchStepState: "COMPLETED",
    semanticOutcome: RESEARCH_TERMINAL_SEMANTIC_OUTCOME,
    evidenceStatus: RESEARCH_TERMINAL_EVIDENCE_STATUS,
    retrievals,
  };
}

/**
 * Narrow, provider-free terminal reconciliation for a failed Research run whose
 * already-persisted synthesis is terminal and non-advancing. It never accepts
 * replacement Research payloads and never reconstructs missing retrieval data.
 */
export class ResearchTerminalReconciliationStore {
  constructor(private readonly pool: pg.Pool) {}

  async reconcile(input: ResearchTerminalReconciliationInput): Promise<ResearchTerminalReconciliationResult> {
    required(input.projectId, "projectId");
    required(input.contentId, "contentId");
    required(input.workflowId, "workflowId");
    required(input.correlationId, "correlationId");
    required(input.sourceRecoveryExecutionId, "sourceRecoveryExecutionId");
    required(input.synthesisResponseId, "synthesisResponseId");
    required(input.synthesisFingerprint, "synthesisFingerprint");
    required(input.reason, "reason");
    required(input.ownerAuthorization, "ownerAuthorization");
    required(input.ownerActor, "ownerActor");
    required(input.idempotencyIdentity, "idempotencyIdentity");
    required(input.identityCollisionRemediationRef, "identityCollisionRemediationRef");
    if (!Number.isSafeInteger(input.sourceJobId) || input.sourceJobId <= 0) {
      throw new Error("RESEARCH_TERMINAL_RECONCILIATION_INVALID_SOURCE_JOB");
    }
    if (input.expectedSemanticOutcome !== RESEARCH_TERMINAL_SEMANTIC_OUTCOME) {
      throw new Error("RESEARCH_TERMINAL_RECONCILIATION_ADVANCING_OUTCOME_FORBIDDEN");
    }

    const artifactId = artifactIdentity(input);
    const auditEventId = auditIdentity(input);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.idempotencyIdentity]);

      const existing = await client.query(
        `SELECT artifact_id,workflow_id,correlation_id,status,payload
         FROM artifacts WHERE artifact_id=$1 FOR UPDATE`, [artifactId],
      );
      if (existing.rowCount) {
        const row = existing.rows[0] as JsonRecord;
        const payload = object(row.payload);
        const reconciliation = object(payload.terminalReconciliation);
        const audit = await client.query(`SELECT event_id FROM owner_control_audit_events WHERE event_id=$1`, [auditEventId]);
        const exact = row.workflow_id === input.workflowId
          && row.correlation_id === input.correlationId
          && row.status === "completed"
          && reconciliation.idempotencyIdentity === input.idempotencyIdentity
          && reconciliation.synthesisResponseId === input.synthesisResponseId
          && reconciliation.synthesisFingerprint === input.synthesisFingerprint
          && reconciliation.semanticOutcome === RESEARCH_TERMINAL_SEMANTIC_OUTCOME
          && audit.rowCount === 1;
        if (!exact) throw new Error("RESEARCH_TERMINAL_RECONCILIATION_IDEMPOTENCY_CONFLICT");
        await client.query("COMMIT");
        return replayResult(row, auditEventId);
      }

      const workflowQuery = await client.query(
        `SELECT workflow_id,state,context,ready FROM workflow_instances WHERE workflow_id=$1 FOR UPDATE`,
        [input.workflowId],
      );
      if (!workflowQuery.rowCount) throw new Error("RESEARCH_TERMINAL_RECONCILIATION_WORKFLOW_NOT_FOUND");
      const workflow = workflowQuery.rows[0];
      const context = object(workflow.context);
      const data = object(context.data);
      if (workflow.state !== "FAILED"
        || context.brandId !== input.projectId
        || data.contentId !== input.contentId
        || context.correlationId !== input.correlationId) {
        throw new Error("RESEARCH_TERMINAL_RECONCILIATION_WORKFLOW_LINEAGE_MISMATCH");
      }

      const stepQuery = await client.query(
        `SELECT status FROM workflow_steps WHERE workflow_id=$1 AND step_id='research' FOR UPDATE`,
        [input.workflowId],
      );
      if (!stepQuery.rowCount || String(stepQuery.rows[0].status).toLowerCase() !== "failed") {
        throw new Error("RESEARCH_TERMINAL_RECONCILIATION_RESEARCH_NOT_FAILED");
      }
      const downstream = await client.query(
        `SELECT step_id,status FROM workflow_steps
         WHERE workflow_id=$1 AND step_id IN ('ceo-recommendation','planner-synthesis','writer','scenes','visual-direction')`,
        [input.workflowId],
      );
      if (downstream.rows.some((row) => String(row.status).toLowerCase() !== "pending")) {
        throw new Error("RESEARCH_TERMINAL_RECONCILIATION_DOWNSTREAM_ALREADY_ADVANCED");
      }

      const job = await client.query(
        `SELECT status FROM workflow_jobs WHERE job_id=$1 AND workflow_id=$2 FOR UPDATE`,
        [input.sourceJobId, input.workflowId],
      );
      if (!job.rowCount || job.rows[0].status !== "failed") {
        throw new Error("RESEARCH_TERMINAL_RECONCILIATION_SOURCE_JOB_MISMATCH");
      }
      const dispatch = await client.query(
        `SELECT authorization_status,dispatch_status FROM workflow_recovery_dispatches
         WHERE workflow_id=$1 AND recovery_execution_id=$2 AND job_id=$3`,
        [input.workflowId, input.sourceRecoveryExecutionId, input.sourceJobId],
      );
      if (!dispatch.rowCount || dispatch.rows[0].authorization_status !== "OWNER_APPROVED"
        || dispatch.rows[0].dispatch_status !== "DISPATCHED") {
        throw new Error("RESEARCH_TERMINAL_RECONCILIATION_SOURCE_RECOVERY_MISMATCH");
      }

      const provenance = await client.query(
        `SELECT status,error_classification FROM execution_provenance
         WHERE execution_id=$1 AND workflow_id=$2 AND agent_id='research' AND stage='research'`,
        [input.sourceRecoveryExecutionId, input.workflowId],
      );
      if (!provenance.rowCount || provenance.rows[0].status !== "failed"
        || provenance.rows[0].error_classification !== "LOCAL_EXECUTION_FAILED") {
        throw new Error("RESEARCH_TERMINAL_RECONCILIATION_FAILURE_CLASS_MISMATCH");
      }
      const failure = await client.query(
        `SELECT metadata FROM execution_lifecycle_events
         WHERE execution_id=$1 AND workflow_id=$2 AND state='FAILED'
         ORDER BY event_id DESC LIMIT 1`,
        [input.sourceRecoveryExecutionId, input.workflowId],
      );
      if (!failure.rowCount || failure.rows[0].metadata?.failureMessage !== "CAPABILITY_EVIDENCE_PERSISTENCE_FAILED:web.search") {
        throw new Error("RESEARCH_TERMINAL_RECONCILIATION_NOT_PERSISTENCE_FAILURE");
      }

      const synthesisQuery = await client.query(
        `SELECT metadata FROM execution_lifecycle_events
         WHERE execution_id=$1 AND workflow_id=$2 AND state='VALIDATING'
           AND metadata->>'providerRequestId'=$3
         ORDER BY event_id DESC LIMIT 1`,
        [input.sourceRecoveryExecutionId, input.workflowId, input.synthesisResponseId],
      );
      if (!synthesisQuery.rowCount) throw new Error("RESEARCH_TERMINAL_RECONCILIATION_SYNTHESIS_NOT_FOUND");
      const synthesisMetadata = object(synthesisQuery.rows[0].metadata);
      if (synthesisMetadata.parsedPayloadFingerprint !== input.synthesisFingerprint) {
        throw new Error("RESEARCH_TERMINAL_RECONCILIATION_SYNTHESIS_FINGERPRINT_MISMATCH");
      }
      if (Number(synthesisMetadata.httpStatus) !== 200 || synthesisMetadata.finishReason !== "stop") {
        throw new Error("RESEARCH_TERMINAL_RECONCILIATION_SYNTHESIS_NOT_COMPLETED");
      }
      const synthesis = parseSynthesis(synthesisMetadata.sanitizedVisibleResponse);
      assertTerminalNonAdvancingSynthesis(synthesis);

      const transportQuery = await client.query(
        `SELECT event_id,state,occurred_at,metadata FROM execution_lifecycle_events
         WHERE execution_id=$1 AND workflow_id=$2
           AND state IN ('CAPABILITY_TRANSPORT_STARTED','CAPABILITY_RESULT_RECEIVED')
         ORDER BY event_id`,
        [input.sourceRecoveryExecutionId, input.workflowId],
      );
      const started = transportQuery.rows.filter((row) => row.state === "CAPABILITY_TRANSPORT_STARTED");
      const received = transportQuery.rows.filter((row) => row.state === "CAPABILITY_RESULT_RECEIVED");
      if (started.length !== 4 || received.length !== 4) {
        throw new Error("RESEARCH_TERMINAL_RECONCILIATION_RETRIEVAL_TRANSPORT_COUNT_MISMATCH");
      }
      for (let index = 0; index < 4; index += 1) {
        if (!started[index].metadata?.idempotencyKey
          || started[index].metadata.idempotencyKey !== received[index].metadata?.idempotencyKey) {
          throw new Error("RESEARCH_TERMINAL_RECONCILIATION_RETRIEVAL_LINEAGE_MISMATCH");
        }
      }

      const retrievals: ResearchRetrievalPersistenceState[] = [];
      for (let index = 0; index < received.length; index += 1) {
        const event = received[index];
        const persisted = await client.query(
          `SELECT c.result_id,c.evidence_id,e.evidence_id AS persisted_evidence_id
           FROM capability_executions c
           LEFT JOIN execution_evidence e ON e.evidence_id=c.evidence_id AND e.workflow_id=c.workflow_id
           WHERE c.workflow_id=$1 AND c.correlation_id=$2 AND c.capability_id='web.search'
             AND c.agent_id='research' AND c.status='success' AND c.executed_at=$3`,
          [input.workflowId, input.correlationId, event.occurred_at],
        );
        const persistedCount = persisted.rowCount ?? 0;
        if (persistedCount > 1) throw new Error("RESEARCH_TERMINAL_RECONCILIATION_AMBIGUOUS_RETRIEVAL_PERSISTENCE");
        if (persistedCount === 1 && !persisted.rows[0].persisted_evidence_id) {
          throw new Error("RESEARCH_TERMINAL_RECONCILIATION_PARTIAL_AVAILABLE_RETRIEVAL");
        }
        retrievals.push({
          ordinal: index + 1,
          idempotencyKey: String(event.metadata.idempotencyKey),
          resultEventAt: String(event.occurred_at),
          state: persistedCount === 1 ? "AVAILABLE" : "TRANSPORT_SUCCEEDED_PAYLOAD_UNAVAILABLE",
          resultId: persistedCount === 1 ? String(persisted.rows[0].result_id) : null,
          evidenceId: persistedCount === 1 ? String(persisted.rows[0].evidence_id) : null,
        });
      }
      const availability = retrievals.map((entry) => entry.state).join(",");
      if (availability !== "AVAILABLE,AVAILABLE,TRANSPORT_SUCCEEDED_PAYLOAD_UNAVAILABLE,TRANSPORT_SUCCEEDED_PAYLOAD_UNAVAILABLE") {
        throw new Error("RESEARCH_TERMINAL_RECONCILIATION_RETRIEVAL_PERSISTENCE_STATE_MISMATCH");
      }

      const now = new Date().toISOString();
      const summary = String(synthesis.summary);
      const artifactPayload = {
        reportId: String(synthesis.reportId ?? `terminal-${digest(input.workflowId, input.synthesisResponseId).slice(0, 24)}`),
        taskId: String(synthesis.taskId ?? "research-research"),
        stage: "research",
        status: "INSUFFICIENT_EVIDENCE",
        summary,
        candidateStories: [],
        sources: [],
        citations: [],
        confidence: Number(synthesis.confidence ?? 0),
        evidenceRisks: Array.isArray(synthesis.evidenceRisks) ? synthesis.evidenceRisks : [],
        evidenceStatus: RESEARCH_TERMINAL_EVIDENCE_STATUS,
        semanticOutcome: RESEARCH_TERMINAL_SEMANTIC_OUTCOME,
        productionEligible: false,
        ceoEligible: false,
        terminalReconciliation: {
          mode: RESEARCH_TERMINAL_RECONCILIATION_MODE,
          idempotencyIdentity: input.idempotencyIdentity,
          sourceJobId: input.sourceJobId,
          sourceRecoveryExecutionId: input.sourceRecoveryExecutionId,
          synthesisResponseId: input.synthesisResponseId,
          synthesisFingerprint: input.synthesisFingerprint,
          semanticOutcome: RESEARCH_TERMINAL_SEMANTIC_OUTCOME,
          evidenceStatus: RESEARCH_TERMINAL_EVIDENCE_STATUS,
          previousFailure: "CAPABILITY_EVIDENCE_PERSISTENCE_FAILED:web.search",
          identityCollisionRemediationRef: input.identityCollisionRemediationRef,
          retrievals,
          missingPayloadsFabricated: false,
          providerCalls: 0,
          reconciledAt: now,
        },
      };
      await client.query(
        `INSERT INTO artifacts
         (artifact_id,workflow_id,kind,producer_agent,correlation_id,status,payload,content_type,schema_version,created_at,parent_artifact_id,parent_artifact_kind)
         VALUES($1,$2,'research_report','research',$3,'completed',$4::jsonb,'application/json','2',$5,
           (SELECT artifact_id FROM artifacts WHERE workflow_id=$2 AND kind='execution_plan' AND status='completed' ORDER BY created_at DESC LIMIT 1),
           'execution_plan')`,
        [artifactId, input.workflowId, input.correlationId, JSON.stringify(artifactPayload), now],
      );

      const nextContext = {
        ...context,
        data: {
          ...data,
          currentStage: "research",
          previousArtifact: { artifactId, kind: "research_report" },
          researchTerminalReconciliation: artifactPayload.terminalReconciliation,
        },
        outputs: { ...object(context.outputs), research: artifactPayload },
      };
      await client.query(
        `UPDATE workflow_instances SET state='BUSINESS_BLOCKED',context=$2::jsonb,ready='[]'::jsonb,updated_at=$3
         WHERE workflow_id=$1`,
        [input.workflowId, JSON.stringify(nextContext), now],
      );
      await client.query(
        `UPDATE workflow_steps SET status='completed',finished_at=$2
         WHERE workflow_id=$1 AND step_id='research'`,
        [input.workflowId, now],
      );
      const auditMetadata = {
        mode: RESEARCH_TERMINAL_RECONCILIATION_MODE,
        ownerAuthorization: input.ownerAuthorization,
        idempotencyIdentity: input.idempotencyIdentity,
        sourceJobId: input.sourceJobId,
        sourceRecoveryExecutionId: input.sourceRecoveryExecutionId,
        synthesisResponseId: input.synthesisResponseId,
        synthesisFingerprint: input.synthesisFingerprint,
        previousFailure: "CAPABILITY_EVIDENCE_PERSISTENCE_FAILED:web.search",
        identityCollisionRemediationRef: input.identityCollisionRemediationRef,
        retrievals,
        missingPayloadsFabricated: false,
        providerCalls: 0,
        budgetMutations: 0,
      };
      await client.query(
        `INSERT INTO owner_control_audit_events
         (event_id,project_id,action,subject_type,subject_id,actor,reason,before_state,after_state,metadata,created_at)
         VALUES($1,$2,$3,'workflow',$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10)`,
        [auditEventId, input.projectId, RESEARCH_TERMINAL_RECONCILIATION_MODE, input.workflowId,
          input.ownerActor, input.reason,
          JSON.stringify({ workflowState: "FAILED", researchStepState: "failed" }),
          JSON.stringify({ workflowState: "BUSINESS_BLOCKED", researchStepState: "COMPLETED", semanticOutcome: RESEARCH_TERMINAL_SEMANTIC_OUTCOME }),
          JSON.stringify(auditMetadata), now],
      );
      await client.query(
        `INSERT INTO execution_lifecycle_events
         (execution_id,workflow_id,stage,state,occurred_at,attempt_number,metadata)
         VALUES($1,$2,'research','TERMINAL_RECONCILED',$3,1,$4::jsonb)`,
        [input.sourceRecoveryExecutionId, input.workflowId, now,
          JSON.stringify({ artifactId, auditEventId, semanticOutcome: RESEARCH_TERMINAL_SEMANTIC_OUTCOME,
            evidenceStatus: RESEARCH_TERMINAL_EVIDENCE_STATUS, providerCalls: 0 })],
      );
      await client.query("COMMIT");
      return {
        outcome: "APPLIED",
        mutated: true,
        artifactId,
        auditEventId,
        workflowState: "BUSINESS_BLOCKED",
        researchStepState: "COMPLETED",
        semanticOutcome: RESEARCH_TERMINAL_SEMANTIC_OUTCOME,
        evidenceStatus: RESEARCH_TERMINAL_EVIDENCE_STATUS,
        retrievals,
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
