import { createHash } from "node:crypto";
import type pg from "pg";
import { assertRecoveryHorizon } from "./recovery-framework.js";

export interface TargetedVerificationAuthorizeInput {
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly workflowId: string;
  readonly artifactId: string;
  readonly selectedCandidateIds: readonly string[];
  readonly verificationObjectives: Readonly<Record<string, string>>;
  readonly maxVerificationRetrievalCalls: number;
  readonly maxReevaluationTextCalls: number;
  readonly authorizedBy: string;
  readonly rationale: string;
}

export interface TargetedVerificationDispatchRecord {
  readonly dispatchId: string;
  readonly idempotencyKey: string;
  readonly projectId: string;
  readonly workflowId: string;
  readonly artifactId: string;
  readonly selectedCandidateIds: readonly string[];
  readonly verificationObjectives: Readonly<Record<string, string>>;
  readonly maxVerificationRetrievalCalls: number;
  readonly maxReevaluationTextCalls: number;
  readonly status: string;
  readonly jobId: number | null;
  readonly revisionId: string | null;
}

const asRecord = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const parse = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;

export class TargetedVerificationDispatcher {
  constructor(private readonly pool: pg.Pool) {}

  async authorizeAndDispatch(input: TargetedVerificationAuthorizeInput): Promise<{ created: boolean; dispatch: TargetedVerificationDispatchRecord }> {
    assertRecoveryHorizon("TARGETED_VERIFICATION", null, ["research"], ["targeted-verification-retrieval", "targeted-verification-reevaluation"]);
    if (!input.idempotencyKey.trim()) throw new Error("TARGETED_VERIFICATION_IDEMPOTENCY_KEY_REQUIRED");
    const selected = [...new Set(input.selectedCandidateIds)];
    if (selected.length === 0 || selected.length !== input.selectedCandidateIds.length) throw new Error("TARGETED_VERIFICATION_CANDIDATE_SELECTION_INVALID");
    if (!Number.isSafeInteger(input.maxVerificationRetrievalCalls) || input.maxVerificationRetrievalCalls < selected.length) throw new Error("TARGETED_VERIFICATION_RETRIEVAL_ENVELOPE_INVALID");
    if (input.maxReevaluationTextCalls !== 1) throw new Error("TARGETED_VERIFICATION_TEXT_ENVELOPE_INVALID");
    const dispatchId = `targeted-verification-${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 32)}`;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [input.idempotencyKey]);
      const existing = await client.query(`SELECT * FROM targeted_verification_dispatches WHERE idempotency_key=$1 FOR UPDATE`, [input.idempotencyKey]);
      if (existing.rowCount) {
        const row = existing.rows[0];
        if (row.project_id !== input.projectId || row.workflow_id !== input.workflowId || row.artifact_id !== input.artifactId
          || JSON.stringify(parse(row.selected_candidate_ids)) !== JSON.stringify(selected)
          || Number(row.max_verification_retrieval_calls) !== input.maxVerificationRetrievalCalls
          || Number(row.max_reevaluation_text_calls) !== input.maxReevaluationTextCalls) throw new Error("TARGETED_VERIFICATION_IDEMPOTENCY_CONFLICT");
        await client.query("COMMIT");
        return { created: false, dispatch: this.map(row) };
      }
      const artifactResult = await client.query(
        `SELECT a.workflow_id,a.kind,a.producer_agent,a.status,a.payload,s.brand_id,wi.state,
          (SELECT status FROM workflow_steps WHERE workflow_id=a.workflow_id AND step_id='research') AS research_status
         FROM artifacts a JOIN workflow_submissions s ON s.workflow_id=a.workflow_id
         JOIN workflow_instances wi ON wi.workflow_id=a.workflow_id WHERE a.artifact_id=$1 FOR UPDATE OF a`,
        [input.artifactId],
      );
      if (!artifactResult.rowCount) throw new Error("TARGETED_VERIFICATION_ARTIFACT_NOT_FOUND");
      const artifact = artifactResult.rows[0];
      if (artifact.workflow_id !== input.workflowId || artifact.brand_id !== input.projectId
        || artifact.kind !== "research_report" || artifact.producer_agent !== "research" || artifact.status !== "completed") throw new Error("TARGETED_VERIFICATION_ARTIFACT_SCOPE_MISMATCH");
      if (String(artifact.state).toUpperCase() !== "PAUSED" || String(artifact.research_status).toUpperCase() !== "COMPLETED") throw new Error("TARGETED_VERIFICATION_OWNER_REVIEW_STATE_REQUIRED");
      const candidates = Array.isArray(artifact.payload?.candidateStories) ? artifact.payload.candidateStories.map(asRecord) : [];
      const byId = new Map<string, Record<string, unknown>>(
        candidates.map((candidate: Record<string, unknown>) => [String(candidate.candidateId ?? ""), candidate] as const),
      );
      for (const candidateId of selected) {
        const candidate = byId.get(candidateId);
        if (!candidate) throw new Error(`TARGETED_VERIFICATION_UNKNOWN_CANDIDATE:${candidateId}`);
        if (["SUPERSEDED", "REJECTED"].includes(String(candidate.lifecycleStatus ?? "").toUpperCase())) throw new Error(`TARGETED_VERIFICATION_CANDIDATE_TERMINAL:${candidateId}`);
      }
      const submission = await client.query(`SELECT submission_key FROM workflow_submissions WHERE workflow_id=$1`, [input.workflowId]);
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO targeted_verification_dispatches
         (dispatch_id,idempotency_key,project_id,workflow_id,artifact_id,selected_candidate_ids,verification_objectives,
          max_verification_retrieval_calls,max_reevaluation_text_calls,authorization_status,status,provenance,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,'OWNER_APPROVED','AUTHORIZED',$10::jsonb,$11,$11)`,
        [dispatchId, input.idempotencyKey, input.projectId, input.workflowId, input.artifactId,
          JSON.stringify(selected), JSON.stringify(input.verificationObjectives), input.maxVerificationRetrievalCalls,
          input.maxReevaluationTextCalls, JSON.stringify({ authorizedBy: input.authorizedBy, rationale: input.rationale, executionMode: "TARGETED_VERIFICATION" }), now],
      );
      const job = await client.query(
        `INSERT INTO workflow_jobs(workflow_id,submission_key,status,attempts,created_at,updated_at)
         VALUES($1,$2,'queued',0,$3,$3) RETURNING job_id`,
        [input.workflowId, submission.rows[0].submission_key, now],
      );
      const jobId = Number(job.rows[0].job_id);
      const updated = await client.query(
        `UPDATE targeted_verification_dispatches SET job_id=$2,status='QUEUED',updated_at=$3 WHERE dispatch_id=$1 RETURNING *`,
        [dispatchId, jobId, now],
      );
      await client.query("COMMIT");
      return { created: true, dispatch: this.map(updated.rows[0]) };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }

  async byJobId(jobId: number): Promise<TargetedVerificationDispatchRecord | null> {
    const result = await this.pool.query(`SELECT * FROM targeted_verification_dispatches WHERE job_id=$1`, [jobId]);
    return result.rowCount ? this.map(result.rows[0]) : null;
  }

  async markRunning(dispatchId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE targeted_verification_dispatches SET status='RUNNING',updated_at=$2
       WHERE dispatch_id=$1 AND status='QUEUED' RETURNING dispatch_id`, [dispatchId, new Date().toISOString()],
    );
    if (result.rowCount) return true;
    const current = await this.pool.query(`SELECT status FROM targeted_verification_dispatches WHERE dispatch_id=$1`, [dispatchId]);
    return current.rows[0]?.status === "RUNNING";
  }

  async settle(dispatchId: string, status: "COMPLETED" | "FAILED", revisionId?: string, errorCode?: string): Promise<void> {
    await this.pool.query(
      `UPDATE targeted_verification_dispatches SET status=$2,revision_id=COALESCE(revision_id,$3),error_code=$4,updated_at=$5
       WHERE dispatch_id=$1 AND status IN('QUEUED','RUNNING')`,
      [dispatchId, status, revisionId ?? null, errorCode ?? null, new Date().toISOString()],
    );
  }

  private map(row: any): TargetedVerificationDispatchRecord {
    return {
      dispatchId: String(row.dispatch_id), idempotencyKey: String(row.idempotency_key), projectId: String(row.project_id),
      workflowId: String(row.workflow_id), artifactId: String(row.artifact_id),
      selectedCandidateIds: parse<string[]>(row.selected_candidate_ids),
      verificationObjectives: parse<Record<string, string>>(row.verification_objectives),
      maxVerificationRetrievalCalls: Number(row.max_verification_retrieval_calls),
      maxReevaluationTextCalls: Number(row.max_reevaluation_text_calls), status: String(row.status),
      jobId: row.job_id == null ? null : Number(row.job_id), revisionId: row.revision_id == null ? null : String(row.revision_id),
    };
  }
}
