import { createHash } from "node:crypto";
import type pg from "pg";

export const WAN_SUPERVISED_STATES = ["AUTHORIZED","SUBMISSION_STARTED","ACKNOWLEDGED","GENERATING","COMPLETED","FAILED","MANUAL_RECONCILIATION_REQUIRED"] as const;
export type WanSupervisedState = typeof WAN_SUPERVISED_STATES[number];

export interface AuthorizeWanSingleSceneInput {
  projectId:string; contentId:string; workflowId:string; sceneId:string;
  sceneVisualArtifactId:string; sceneVisualSha256:string;
  provider:string; model:string; endpointId:string; modelConfig:Record<string,unknown>;
  ownerActor:string; ownerRationale:string; idempotencyIdentity:string;
  expectedWorkerBuild:string; operationMode:string;
}

export interface WanSupervisedExecutionRecord {
  wanExecutionId:string; idempotencyIdentity:string; projectId:string; contentId:string; workflowId:string;
  sceneId:string; sourceVisualArtifactId:string; sourceVisualSha256:string; clientExecutionId:string;
  provider:string; model:string; endpointId:string; modelConfig:Record<string,unknown>; providerJobId:string|null;
  state:WanSupervisedState; ownerActor:string; ownerRationale:string; authorizationId:string;
  budgetClaimId:string; budgetState:"RESERVED"|"CONSUMED"|"RELEASED"; providerPostCount:number;
  submissionStartedAt:string|null; acknowledgedAt:string|null; completedAt:string|null;
  failureClass:string|null; reconciliationState:string; outputEvidence:Record<string,unknown>|null;
  claimedByWorker:string|null; createdAt:string; updatedAt:string;
}

const digest=(...parts:string[])=>createHash("sha256").update(parts.join("\0")).digest("hex");
const nonempty=(value:string,name:string)=>{const v=value.trim();if(!v)throw new Error(`${name}_REQUIRED`);return v};
const row=(r:any):WanSupervisedExecutionRecord=>({wanExecutionId:r.wan_execution_id,idempotencyIdentity:r.idempotency_identity,projectId:r.project_id,contentId:r.content_id,workflowId:r.workflow_id,sceneId:r.scene_id,sourceVisualArtifactId:r.source_visual_artifact_id,sourceVisualSha256:r.source_visual_sha256,clientExecutionId:r.client_execution_id,provider:r.provider,model:r.model,endpointId:r.endpoint_id,modelConfig:r.model_config??{},providerJobId:r.provider_job_id??null,state:r.state,ownerActor:r.owner_actor,ownerRationale:r.owner_rationale,authorizationId:r.authorization_id,budgetClaimId:r.budget_claim_id,budgetState:r.budget_state,providerPostCount:Number(r.provider_post_count),submissionStartedAt:r.submission_started_at??null,acknowledgedAt:r.acknowledged_at??null,completedAt:r.completed_at??null,failureClass:r.failure_class??null,reconciliationState:r.reconciliation_state,outputEvidence:r.output_evidence??null,claimedByWorker:r.claimed_by_worker??null,createdAt:r.created_at,updatedAt:r.updated_at});

export class WanSupervisedExecutionStore {
  constructor(private readonly pool:pg.Pool){}

  async authorize(input:AuthorizeWanSingleSceneInput):Promise<{created:boolean;outcome:"AUTHORIZED"|"IDEMPOTENT_REPLAY"|"EXISTING_EXECUTION_ACTIVE";execution:WanSupervisedExecutionRecord}>{
    for(const [name,value] of Object.entries({PROJECT_ID:input.projectId,CONTENT_ID:input.contentId,WORKFLOW_ID:input.workflowId,SCENE_ID:input.sceneId,SOURCE_VISUAL_ARTIFACT_ID:input.sceneVisualArtifactId,PROVIDER:input.provider,MODEL:input.model,ENDPOINT_ID:input.endpointId,OWNER_ACTOR:input.ownerActor,OWNER_RATIONALE:input.ownerRationale,IDEMPOTENCY_IDENTITY:input.idempotencyIdentity}))nonempty(value,name);
    if(!/^[a-f0-9]{64}$/i.test(input.sceneVisualSha256))throw new Error("SOURCE_VISUAL_SHA256_INVALID");
    if(input.operationMode!=="TEMPORARY_GOVERNED_LEGACY_ENDPOINT")throw new Error("WAN_SUPERVISED_MODE_NOT_ACTIVE");
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`wan-supervised:${input.projectId}:${input.workflowId}:${input.sceneId}`]);
      const replay=await c.query(`SELECT * FROM wan_supervised_executions WHERE idempotency_identity=$1 FOR UPDATE`,[input.idempotencyIdentity]);
      if(replay.rowCount){await c.query("COMMIT");return{created:false,outcome:"IDEMPOTENT_REPLAY",execution:row(replay.rows[0])}}
      const project=await c.query(`SELECT project_id FROM control_projects WHERE project_id=$1 AND status='ACTIVE'`,[input.projectId]);
      if(!project.rowCount)throw new Error("PROJECT_NOT_FOUND_OR_INACTIVE");
      const visual=await c.query(`SELECT artifact_id,workflow_id,payload FROM artifacts WHERE artifact_id=$1 AND kind='scene_visual_artifact' AND status='completed' FOR SHARE`,[input.sceneVisualArtifactId]);
      if(!visual.rowCount)throw new Error("APPROVED_SOURCE_VISUAL_NOT_FOUND");
      const vp=visual.rows[0].payload as Record<string,unknown>;
      if(visual.rows[0].workflow_id!==input.workflowId||String(vp.projectId)!==input.projectId||String(vp.contentId)!==input.contentId||String(vp.sceneId)!==input.sceneId)throw new Error("CROSS_PROJECT_OR_SCENE_VISUAL_DENIED");
      if(String(vp.sha256??vp.imageSha256??"").toLowerCase()!==input.sceneVisualSha256.toLowerCase())throw new Error("SOURCE_VISUAL_SHA256_MISMATCH");
      const approval=await c.query(`SELECT artifact_id,payload FROM artifacts WHERE workflow_id=$1 AND kind='wan_authorization' AND status='completed' AND parent_artifact_id=$2 AND payload->>'sceneId'=$3 ORDER BY created_at DESC LIMIT 1 FOR SHARE`,[input.workflowId,input.sceneVisualArtifactId,input.sceneId]);
      if(!approval.rowCount)throw new Error("SOURCE_VISUAL_OWNER_APPROVAL_REQUIRED");
      const worker=await c.query(`SELECT build_id,last_heartbeat_at FROM amf_worker_presence WHERE runtime_mode='PERSISTENT_PRODUCTION_WORKER' AND last_heartbeat_at >= $1 ORDER BY last_heartbeat_at DESC LIMIT 3`,[new Date(Date.now()-120_000).toISOString()]);
      if(worker.rowCount!==1||worker.rows[0].build_id!==input.expectedWorkerBuild)throw new Error("CURRENT_HEALTHY_SINGLETON_WORKER_REQUIRED");
      const active=await c.query(`SELECT * FROM wan_supervised_executions WHERE project_id=$1 AND workflow_id=$2 AND scene_id=$3 AND state NOT IN('COMPLETED','FAILED') FOR UPDATE`,[input.projectId,input.workflowId,input.sceneId]);
      if(active.rowCount){await c.query("COMMIT");return{created:false,outcome:"EXISTING_EXECUTION_ACTIVE",execution:row(active.rows[0])}}
      const budget=await c.query(`SELECT limit_count,used_count FROM automation_call_budgets WHERE project_id=$1 AND call_kind='video_generation' FOR UPDATE`,[input.projectId]);
      if(!budget.rowCount)throw new Error("VIDEO_GENERATION_BUDGET_UNAVAILABLE");
      const reserved=await c.query(`SELECT COUNT(*)::int AS count FROM wan_supervised_executions WHERE project_id=$1 AND budget_state='RESERVED'`,[input.projectId]);
      if(Number(budget.rows[0].used_count)+Number(reserved.rows[0].count)>=Number(budget.rows[0].limit_count))throw new Error("VIDEO_GENERATION_HARD_CAP_STOP");
      const identity=digest(input.projectId,input.workflowId,input.sceneId,input.idempotencyIdentity);
      const executionId=`wan-exec-${identity.slice(0,24)}`,authorizationId=`wan-auth-${identity.slice(0,24)}`,budgetClaimId=`wan-budget-${identity.slice(0,24)}`,clientExecutionId=`wan-client-${identity.slice(0,32)}`,now=new Date().toISOString();
      const inserted=await c.query(`INSERT INTO wan_supervised_executions(wan_execution_id,idempotency_identity,project_id,content_id,workflow_id,scene_id,source_visual_artifact_id,source_visual_sha256,client_execution_id,provider,model,endpoint_id,model_config,state,owner_actor,owner_rationale,authorization_id,budget_claim_id,budget_state,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,'AUTHORIZED',$14,$15,$16,$17,'RESERVED',$18,$18) RETURNING *`,[executionId,input.idempotencyIdentity,input.projectId,input.contentId,input.workflowId,input.sceneId,input.sceneVisualArtifactId,input.sceneVisualSha256.toLowerCase(),clientExecutionId,input.provider,input.model,input.endpointId,JSON.stringify(input.modelConfig),input.ownerActor,input.ownerRationale,authorizationId,budgetClaimId,now]);
      await c.query(`INSERT INTO owner_control_audit_events(event_id,project_id,action,subject_type,subject_id,actor,reason,before_state,after_state,metadata,created_at) VALUES($1,$2,'GENERATE_WAN_SINGLE_SCENE','wan_supervised_execution',$3,$4,$5,NULL,$6::jsonb,$7::jsonb,$8)`,[`audit-${identity.slice(0,32)}`,input.projectId,executionId,input.ownerActor,input.ownerRationale,JSON.stringify({state:"AUTHORIZED"}),JSON.stringify({workflowId:input.workflowId,contentId:input.contentId,sceneId:input.sceneId,sourceVisualArtifactId:input.sceneVisualArtifactId,authorizationId,budgetClaimId,providerPostCount:0,batch:false,automaticRetry:false}),now]);
      await c.query("COMMIT");return{created:true,outcome:"AUTHORIZED",execution:row(inserted.rows[0])};
    }catch(error){await c.query("ROLLBACK");throw error}finally{c.release()}
  }

  async claimNext(workerId:string):Promise<WanSupervisedExecutionRecord|null>{
    const c=await this.pool.connect();try{await c.query("BEGIN");const q=await c.query(`SELECT * FROM wan_supervised_executions WHERE state='AUTHORIZED' ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);if(!q.rowCount){await c.query("COMMIT");return null}const current=q.rows[0];const now=new Date().toISOString();const budget=await c.query(`UPDATE automation_call_budgets SET used_count=used_count+1,updated_at=$2 WHERE project_id=$1 AND call_kind='video_generation' AND used_count < limit_count RETURNING used_count`,[current.project_id,now]);if(!budget.rowCount)throw new Error("VIDEO_GENERATION_HARD_CAP_STOP");const updated=await c.query(`UPDATE wan_supervised_executions SET state='SUBMISSION_STARTED',budget_state='CONSUMED',provider_post_count=1,submission_started_at=$2,claimed_by_worker=$3,updated_at=$2 WHERE wan_execution_id=$1 AND state='AUTHORIZED' AND provider_post_count=0 RETURNING *`,[current.wan_execution_id,now,workerId]);if(!updated.rowCount)throw new Error("WAN_EXECUTION_CLAIM_RACE");await c.query("COMMIT");return row(updated.rows[0]);}catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
  }

  async acknowledge(executionId:string,providerJobId:string):Promise<WanSupervisedExecutionRecord>{return this.transition(executionId,["SUBMISSION_STARTED"],"ACKNOWLEDGED",{providerJobId:nonempty(providerJobId,"PROVIDER_JOB_ID"),acknowledgedAt:new Date().toISOString()})}
  async markGenerating(executionId:string):Promise<WanSupervisedExecutionRecord>{return this.transition(executionId,["ACKNOWLEDGED","GENERATING"],"GENERATING",{})}
  async complete(executionId:string,evidence:Record<string,unknown>):Promise<WanSupervisedExecutionRecord>{return this.transition(executionId,["ACKNOWLEDGED","GENERATING"],"COMPLETED",{completedAt:new Date().toISOString(),outputEvidence:evidence})}
  async fail(executionId:string,failureClass:string):Promise<WanSupervisedExecutionRecord>{return this.transition(executionId,["SUBMISSION_STARTED","ACKNOWLEDGED","GENERATING"],"FAILED",{completedAt:new Date().toISOString(),failureClass:nonempty(failureClass,"FAILURE_CLASS")})}
  async requireManualReconciliation(executionId:string,failureClass:string):Promise<WanSupervisedExecutionRecord>{return this.transition(executionId,["SUBMISSION_STARTED","ACKNOWLEDGED","GENERATING"],"MANUAL_RECONCILIATION_REQUIRED",{failureClass:nonempty(failureClass,"FAILURE_CLASS"),reconciliationState:"ACTION_REQUIRED"})}
  async attachProviderJobId(input:{projectId:string;executionId:string;providerJobId:string;actor:string;rationale:string}):Promise<WanSupervisedExecutionRecord>{
    const c=await this.pool.connect();try{await c.query("BEGIN");const q=await c.query(`SELECT * FROM wan_supervised_executions WHERE wan_execution_id=$1 FOR UPDATE`,[input.executionId]);if(!q.rowCount)throw new Error("WAN_EXECUTION_NOT_FOUND");const prior=q.rows[0];if(prior.project_id!==input.projectId)throw new Error("CROSS_PROJECT_DENIED");if(prior.state!=="MANUAL_RECONCILIATION_REQUIRED")throw new Error("WAN_RECONCILIATION_NOT_REQUIRED");const job=nonempty(input.providerJobId,"PROVIDER_JOB_ID");if(prior.provider_job_id&&prior.provider_job_id!==job)throw new Error("CONFLICTING_PROVIDER_JOB_ID");const now=new Date().toISOString();const u=await c.query(`UPDATE wan_supervised_executions SET provider_job_id=$2,reconciliation_state='OWNER_JOB_ID_ATTACHED',updated_at=$3 WHERE wan_execution_id=$1 RETURNING *`,[input.executionId,job,now]);await c.query(`INSERT INTO owner_control_audit_events(event_id,project_id,action,subject_type,subject_id,actor,reason,before_state,after_state,metadata,created_at) VALUES($1,$2,'ATTACH_PROVIDER_JOB_ID','wan_supervised_execution',$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9)`,[`audit-${digest(input.executionId,"attach",job).slice(0,32)}`,input.projectId,input.executionId,input.actor,input.rationale,JSON.stringify({state:prior.state,reconciliationState:prior.reconciliation_state}),JSON.stringify({state:prior.state,reconciliationState:"OWNER_JOB_ID_ATTACHED"}),JSON.stringify({classification:"OWNER_SUPPLIED_PROVIDER_JOB_ID",providerIdentityProof:"OWNER_ATTESTED_NOT_PROVIDER_VERIFIED",newVideoPosts:0,additionalGenerationBudget:0}),now]);await c.query("COMMIT");return row(u.rows[0]);}catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
  }

  async list(projectId:string):Promise<WanSupervisedExecutionRecord[]>{const q=await this.pool.query(`SELECT * FROM wan_supervised_executions WHERE project_id=$1 ORDER BY created_at DESC`,[projectId]);return q.rows.map(row)}
  async approvedScenes(projectId:string){const q=await this.pool.query(`SELECT DISTINCT ON (v.workflow_id,v.payload->>'sceneId') v.workflow_id,v.artifact_id AS visual_artifact_id,v.payload AS visual_payload,a.artifact_id AS authorization_id,a.payload AS authorization_payload FROM artifacts v JOIN artifacts a ON a.workflow_id=v.workflow_id AND a.kind='wan_authorization' AND a.status='completed' AND a.parent_artifact_id=v.artifact_id WHERE v.kind='scene_visual_artifact' AND v.status='completed' AND v.payload->>'projectId'=$1 ORDER BY v.workflow_id,v.payload->>'sceneId',a.created_at DESC`,[projectId]);const executions=await this.list(projectId);return q.rows.map((r:any)=>{const v=r.visual_payload??{},sceneId=String(v.sceneId??r.authorization_payload?.sceneId??"");const active=executions.find(x=>x.workflowId===r.workflow_id&&x.sceneId===sceneId&&!['COMPLETED','FAILED'].includes(x.state));return{projectId,contentId:String(v.contentId??""),workflowId:r.workflow_id,sceneId,sceneVisualArtifactId:r.visual_artifact_id,sceneVisualSha256:String(v.sha256??v.imageSha256??""),authorizationId:r.authorization_id,activeExecution:active??null,eligible:!active&&/^[a-f0-9]{64}$/i.test(String(v.sha256??v.imageSha256??""))}})}
  async decisionItems(projectId:string){const rows=await this.list(projectId);return rows.filter(x=>x.state==="MANUAL_RECONCILIATION_REQUIRED").map(x=>({approvalId:`wan-reconciliation:${x.wanExecutionId}`,projectId,targetType:"wan_reconciliation",targetId:x.wanExecutionId,status:"PENDING",actionability:"ACTION_REQUIRED",actionabilityReason:x.reconciliationState,evidence:{sceneId:x.sceneId,sourceVisualArtifactId:x.sourceVisualArtifactId,submissionStartedAt:x.submissionStartedAt,endpointId:x.endpointId,providerJobId:x.providerJobId},business:{title:"Reconcile supervised Wan submission",allowedActions:["ATTACH_PROVIDER_JOB_ID","IMPORT_OWNER_DOWNLOADED_OUTPUT"],notEffects:["Never issues another generation POST.","Never consumes a second generation budget claim."]}}))}

  private async transition(executionId:string,from:WanSupervisedState[],to:WanSupervisedState,extra:{providerJobId?:string;acknowledgedAt?:string;completedAt?:string;failureClass?:string;reconciliationState?:string;outputEvidence?:Record<string,unknown>}):Promise<WanSupervisedExecutionRecord>{const now=new Date().toISOString();const q=await this.pool.query(`UPDATE wan_supervised_executions SET state=$2,provider_job_id=COALESCE(provider_job_id,$3),acknowledged_at=COALESCE(acknowledged_at,$4),completed_at=COALESCE(completed_at,$5),failure_class=COALESCE($6,failure_class),reconciliation_state=COALESCE($7,reconciliation_state),output_evidence=COALESCE($8::jsonb,output_evidence),updated_at=$9 WHERE wan_execution_id=$1 AND state=ANY($10::text[]) RETURNING *`,[executionId,to,extra.providerJobId??null,extra.acknowledgedAt??null,extra.completedAt??null,extra.failureClass??null,extra.reconciliationState??null,extra.outputEvidence?JSON.stringify(extra.outputEvidence):null,now,from]);if(!q.rowCount)throw new Error("WAN_EXECUTION_STATE_TRANSITION_INVALID");return row(q.rows[0])}
}
