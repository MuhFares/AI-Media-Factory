import { createHash } from "node:crypto";
import type pg from "pg";
import { assertRecoveryHorizon } from "./recovery-framework.js";

export interface TargetedReevaluationRecoveryAuthorizeInput {
  readonly authorizationKey: string;
  readonly sourceDispatchId: string;
  readonly projectId: string;
  readonly contentId: string;
  readonly workflowId: string;
  readonly artifactId: string;
  readonly selectedCandidateIds: readonly string[];
  readonly maxReevaluationTextCalls: 1;
  readonly authorizedBy: string;
  readonly rationale: string;
}

export interface TargetedReevaluationRecoveryRecord {
  readonly recoveryId: string;
  readonly authorizationKey: string;
  readonly sourceDispatchId: string;
  readonly projectId: string;
  readonly contentId: string;
  readonly workflowId: string;
  readonly artifactId: string;
  readonly selectedCandidateIds: readonly string[];
  readonly maxReevaluationTextCalls: 1;
  readonly status: string;
  readonly jobId: number | null;
  readonly revisionId: string | null;
}

const parse = <T>(value: unknown): T => (typeof value === "string" ? JSON.parse(value) : value) as T;

/** Owner-authorized, retrieval-free recovery of one failed targeted reevaluation. */
export class TargetedVerificationReevaluationRecoveryDispatcher {
  constructor(private readonly pool: pg.Pool) {}

  async authorizeAndDispatch(input: TargetedReevaluationRecoveryAuthorizeInput): Promise<{ created: boolean; recovery: TargetedReevaluationRecoveryRecord }> {
    assertRecoveryHorizon("TARGETED_REEVALUATION_RECOVERY", null, ["research"], ["targeted-verification-reevaluation"]);
    if (!input.authorizationKey.trim()) throw new Error("TARGETED_REEVALUATION_RECOVERY_AUTHORIZATION_REQUIRED");
    if (input.maxReevaluationTextCalls !== 1) throw new Error("TARGETED_REEVALUATION_RECOVERY_TEXT_LIMIT_INVALID");
    const selected = [...new Set(input.selectedCandidateIds)];
    if (selected.length === 0 || selected.length !== input.selectedCandidateIds.length) throw new Error("TARGETED_REEVALUATION_RECOVERY_CANDIDATES_INVALID");
    const recoveryId = `targeted-reevaluation-recovery-${createHash("sha256").update(input.authorizationKey).digest("hex").slice(0, 32)}`;
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [input.authorizationKey]);
      const existing = await client.query(`SELECT * FROM targeted_verification_reevaluation_recoveries WHERE authorization_key=$1 FOR UPDATE`, [input.authorizationKey]);
      if (existing.rowCount) {
        const row = existing.rows[0];
        if (row.source_dispatch_id !== input.sourceDispatchId || row.project_id !== input.projectId || row.content_id !== input.contentId
          || row.workflow_id !== input.workflowId || row.artifact_id !== input.artifactId
          || JSON.stringify(parse(row.selected_candidate_ids)) !== JSON.stringify(selected)) throw new Error("TARGETED_REEVALUATION_RECOVERY_IDEMPOTENCY_CONFLICT");
        await client.query("COMMIT");
        return { created: false, recovery: this.map(row) };
      }
      const source = await client.query(
        `SELECT d.*,a.kind,a.producer_agent,a.status AS artifact_status,s.brand_id,wi.state,wi.context,
          (SELECT status FROM workflow_steps WHERE workflow_id=d.workflow_id AND step_id='research') AS research_status
         FROM targeted_verification_dispatches d JOIN artifacts a ON a.artifact_id=d.artifact_id
         JOIN workflow_submissions s ON s.workflow_id=d.workflow_id JOIN workflow_instances wi ON wi.workflow_id=d.workflow_id
         WHERE d.dispatch_id=$1 FOR UPDATE OF d,a`, [input.sourceDispatchId],
      );
      if (!source.rowCount) throw new Error("TARGETED_REEVALUATION_RECOVERY_SOURCE_NOT_FOUND");
      const row = source.rows[0];
      const context = parse<Record<string, any>>(row.context);
      if (row.status !== "FAILED" || row.project_id !== input.projectId || row.workflow_id !== input.workflowId
        || row.artifact_id !== input.artifactId || row.brand_id !== input.projectId || context?.data?.contentId !== input.contentId
        || row.kind !== "research_report" || row.producer_agent !== "research" || row.artifact_status !== "completed"
        || String(row.state).toUpperCase() !== "PAUSED" || String(row.research_status).toUpperCase() !== "COMPLETED") {
        throw new Error("TARGETED_REEVALUATION_RECOVERY_SCOPE_MISMATCH");
      }
      if (JSON.stringify(parse(row.selected_candidate_ids)) !== JSON.stringify(selected)) throw new Error("TARGETED_REEVALUATION_RECOVERY_SELECTION_MISMATCH");
      const priorRevision = await client.query(`SELECT repair_id FROM artifact_integrity_repairs WHERE recovery_execution_id=$1`, [input.sourceDispatchId]);
      if (priorRevision.rowCount) throw new Error("TARGETED_REEVALUATION_RECOVERY_REVISION_ALREADY_EXISTS");
      for (const candidateId of selected) {
        const resultId = `web-search-result-${input.sourceDispatchId}:verify-${candidateId}-q1`;
        const evidenceId = `evidence-${resultId}`;
        const evidence = await client.query(
          `SELECT c.result_id,c.evidence_id,c.status,c.capability_id,c.workflow_id,c.correlation_id,c.idempotency_key,e.evidence_id AS persisted_evidence_id,e.succeeded,e.workflow_id AS evidence_workflow,e.correlation_id AS evidence_correlation
           FROM capability_executions c JOIN execution_evidence e ON e.evidence_id=c.evidence_id
           WHERE c.result_id=$1 AND c.evidence_id=$2`, [resultId, evidenceId],
        );
        if (!evidence.rowCount) throw new Error(`TARGETED_REEVALUATION_RECOVERY_EVIDENCE_MISSING:${candidateId}`);
        const item = evidence.rows[0];
        if (item.status !== "success" || item.capability_id !== "web.search" || item.succeeded !== true
          || item.workflow_id !== input.workflowId || item.evidence_workflow !== input.workflowId
          || item.correlation_id !== input.sourceDispatchId || item.evidence_correlation !== input.sourceDispatchId
          || !String(item.idempotency_key).includes(`:${candidateId}:retrieval`)) {
          throw new Error(`TARGETED_REEVALUATION_RECOVERY_EVIDENCE_INTEGRITY_FAILED:${candidateId}`);
        }
      }
      const submission = await client.query(`SELECT submission_key FROM workflow_submissions WHERE workflow_id=$1`, [input.workflowId]);
      const now = new Date().toISOString();
      await client.query(
        `INSERT INTO targeted_verification_reevaluation_recoveries
         (recovery_id,authorization_key,source_dispatch_id,project_id,content_id,workflow_id,artifact_id,selected_candidate_ids,max_reevaluation_text_calls,status,provenance,created_at,updated_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,1,'AUTHORIZED',$9::jsonb,$10,$10)`,
        [recoveryId,input.authorizationKey,input.sourceDispatchId,input.projectId,input.contentId,input.workflowId,input.artifactId,JSON.stringify(selected),JSON.stringify({ authorizedBy: input.authorizedBy,rationale: input.rationale,executionMode:"TARGETED_VERIFICATION_REEVALUATION_RECOVERY",retrievalsReused:selected.length,newRetrievals:0 }),now],
      );
      const job = await client.query(`INSERT INTO workflow_jobs(workflow_id,submission_key,status,attempts,created_at,updated_at) VALUES($1,$2,'queued',0,$3,$3) RETURNING job_id`, [input.workflowId,submission.rows[0].submission_key,now]);
      const updated = await client.query(`UPDATE targeted_verification_reevaluation_recoveries SET job_id=$2,status='QUEUED',updated_at=$3 WHERE recovery_id=$1 RETURNING *`, [recoveryId,Number(job.rows[0].job_id),now]);
      await client.query("COMMIT");
      return { created:true,recovery:this.map(updated.rows[0]) };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async byJobId(jobId:number):Promise<TargetedReevaluationRecoveryRecord|null>{const q=await this.pool.query(`SELECT * FROM targeted_verification_reevaluation_recoveries WHERE job_id=$1`,[jobId]);return q.rowCount?this.map(q.rows[0]):null;}
  async markRunning(recoveryId:string):Promise<boolean>{const q=await this.pool.query(`UPDATE targeted_verification_reevaluation_recoveries SET status='RUNNING',updated_at=$2 WHERE recovery_id=$1 AND status='QUEUED' RETURNING recovery_id`,[recoveryId,new Date().toISOString()]);if(q.rowCount)return true;const x=await this.pool.query(`SELECT status FROM targeted_verification_reevaluation_recoveries WHERE recovery_id=$1`,[recoveryId]);return x.rows[0]?.status==="RUNNING";}
  async settle(recoveryId:string,status:"COMPLETED"|"FAILED",revisionId?:string,errorCode?:string,routeSnapshot?:Record<string,unknown>):Promise<void>{await this.pool.query(`UPDATE targeted_verification_reevaluation_recoveries SET status=$2,revision_id=COALESCE(revision_id,$3),error_code=$4,route_snapshot=COALESCE(route_snapshot,$5::jsonb),updated_at=$6 WHERE recovery_id=$1 AND status IN('QUEUED','RUNNING')`,[recoveryId,status,revisionId??null,errorCode??null,routeSnapshot?JSON.stringify(routeSnapshot):null,new Date().toISOString()]);}
  private map(row:any):TargetedReevaluationRecoveryRecord{return{recoveryId:String(row.recovery_id),authorizationKey:String(row.authorization_key),sourceDispatchId:String(row.source_dispatch_id),projectId:String(row.project_id),contentId:String(row.content_id),workflowId:String(row.workflow_id),artifactId:String(row.artifact_id),selectedCandidateIds:parse<string[]>(row.selected_candidate_ids),maxReevaluationTextCalls:1,status:String(row.status),jobId:row.job_id==null?null:Number(row.job_id),revisionId:row.revision_id==null?null:String(row.revision_id)};}
}
