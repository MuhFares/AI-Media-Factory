import type pg from "pg";
import { VALIDATION_ACCEPTANCE_SCOPE, VALIDATION_ACCEPTANCE_BIT_KEY } from "./validation-acceptance.js";

export type OwnerDecision = "APPROVE" | "MODIFY" | "REJECT" | "REQUEST_ITERATION" | "OVERRIDE";
export interface ApprovalRecord { approvalId:string; projectId:string; targetType:string; targetId:string; agentRecommendation:unknown; agentConfidence:string|null; evidenceRefs:unknown[]; ownerDecision:OwnerDecision|null; ownerRationale:string|null; status:string; supersedes:string|null; supersededBy:string|null; createdAt:string; decidedAt:string|null; }
export interface ReviewRevisionTask { taskId:string; workflowId:string; commandId:string|null; projectId:string|null; correlationId:string|null; reviewExecutionId:string|null; reviewArtifactId:string; writerArtifactId:string; seoArtifactId:string; brandArtifactId:string; status:string; reviewStatus:"changes_requested"|"owner_iteration_requested"; summary:string; findings:unknown[]; recommendations:unknown[]; createdAt:string; revisionVersion:number; authorizedAt:string|null; authorizedBy:string|null; completedAt:string|null; }
export type HumanGateKey = "pre_production" | "visual";
export type HumanGateScopeType = "GLOBAL" | "PROJECT";
export const HUMAN_GATE_KEYS: readonly HumanGateKey[] = ["pre_production", "visual"];
/** Built-in safety default: human gates are REQUIRED unless an owner explicitly disables them. */
export const HUMAN_GATE_DEFAULT_ENABLED = true;

export interface HumanGateSetting { scopeType:HumanGateScopeType; scopeId:string; gateKey:HumanGateKey; enabled:boolean; updatedBy:string; updatedAt:string; }
export interface EffectiveHumanGatePolicy { preProductionEnabled:boolean; visualHumanGateEnabled:boolean; resolvedScope:"PROJECT"|"GLOBAL"|"DEFAULT"; configurationVersion:number; resolvedAt:string; }
export interface HumanGateConfigurationEvent { eventId:string; gateKey:HumanGateKey; scopeType:HumanGateScopeType; scopeId:string; oldValue:{enabled:boolean}|null; newValue:{enabled:boolean}|null; changedBy:string; changedAt:string; source:string; rationale:string; correlationId:string|null; }

const gateSetting=(r:any):HumanGateSetting=>({scopeType:r.scope_type,scopeId:r.scope_id,gateKey:r.gate_key,enabled:r.enabled===true,updatedBy:r.updated_by,updatedAt:r.updated_at});
const gateEvent=(r:any):HumanGateConfigurationEvent=>({eventId:r.event_id,gateKey:r.gate_key,scopeType:r.scope_type,scopeId:r.scope_id,oldValue:r.old_value??null,newValue:r.new_value??null,changedBy:r.changed_by,changedAt:r.changed_at,source:r.source,rationale:r.rationale,correlationId:r.correlation_id??null});
const parse=(value:unknown):any=>typeof value==="string"?JSON.parse(value):value;
const approval=(r:any):ApprovalRecord=>({approvalId:r.approval_id,projectId:r.project_id,targetType:r.target_type,targetId:r.target_id,agentRecommendation:parse(r.agent_recommendation),agentConfidence:r.agent_confidence,evidenceRefs:parse(r.evidence_refs),ownerDecision:r.owner_decision,ownerRationale:r.owner_rationale,status:r.status,supersedes:r.supersedes,supersededBy:r.superseded_by,createdAt:r.created_at,decidedAt:r.decided_at});
const revisionTask=(r:any):ReviewRevisionTask=>({taskId:r.task_id,workflowId:r.workflow_id,commandId:r.command_id,projectId:r.project_id,correlationId:r.correlation_id,reviewExecutionId:r.review_execution_id,reviewArtifactId:r.review_artifact_id,writerArtifactId:r.writer_artifact_id,seoArtifactId:r.seo_artifact_id,brandArtifactId:r.brand_artifact_id,status:r.status,reviewStatus:r.review_status,summary:r.summary,findings:parse(r.findings),recommendations:parse(r.recommendations),createdAt:r.created_at,revisionVersion:Number(r.revision_version??0),authorizedAt:r.authorized_at??null,authorizedBy:r.authorized_by??null,completedAt:r.completed_at??null});

export class ControlPlaneStore {
  constructor(private readonly pool:pg.Pool) {}
  async createApproval(input:Omit<ApprovalRecord,"ownerDecision"|"ownerRationale"|"decidedAt">):Promise<ApprovalRecord>{
    await this.pool.query(`INSERT INTO control_approvals (approval_id,project_id,target_type,target_id,agent_recommendation,agent_confidence,evidence_refs,status,supersedes,superseded_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (approval_id) DO NOTHING`,[input.approvalId,input.projectId,input.targetType,input.targetId,JSON.stringify(input.agentRecommendation),input.agentConfidence,JSON.stringify(input.evidenceRefs),input.status,input.supersedes,input.supersededBy,input.createdAt]);
    return (await this.getApproval(input.approvalId))!;
  }
  async decideApproval(id:string,decision:OwnerDecision,rationale:string,opts?:{validationAcceptance?:boolean}):Promise<ApprovalRecord|null>{
    if (opts?.validationAcceptance === true) {
      const current = await this.getApproval(id);
      if (!current) return null;
      if (decision !== "APPROVE") throw new Error("VALIDATION_ACCEPTANCE_REQUIRES_APPROVE");
      if (current.targetType !== VALIDATION_ACCEPTANCE_SCOPE) throw new Error(`VALIDATION_ACCEPTANCE_SCOPE_MISMATCH:${current.targetType}`);
    }
    await this.pool.query(`UPDATE control_approvals SET owner_decision=$2,owner_rationale=$3,status='DECIDED',decided_at=$4 WHERE approval_id=$1`,[id,decision,rationale,new Date().toISOString()]);
    if (opts?.validationAcceptance === true) {
      await this.pool.query(`UPDATE control_approvals SET agent_recommendation=COALESCE(agent_recommendation,'{}'::jsonb)||jsonb_build_object($2::text,TRUE) WHERE approval_id=$1`,[id,VALIDATION_ACCEPTANCE_BIT_KEY]);
    }
    return this.getApproval(id);
  }
  async getApproval(id:string):Promise<ApprovalRecord|null>{const q=await this.pool.query(`SELECT * FROM control_approvals WHERE approval_id=$1`,[id]);return q.rowCount?approval(q.rows[0]):null;}
  async createReviewRevisionTask(input:Omit<ReviewRevisionTask,"revisionVersion"|"authorizedAt"|"authorizedBy"|"completedAt">):Promise<ReviewRevisionTask>{
    await this.pool.query(`INSERT INTO review_revision_tasks (task_id,workflow_id,command_id,project_id,correlation_id,review_execution_id,review_artifact_id,writer_artifact_id,seo_artifact_id,brand_artifact_id,status,review_status,summary,findings,recommendations,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) ON CONFLICT (workflow_id,review_artifact_id) DO NOTHING`,[input.taskId,input.workflowId,input.commandId,input.projectId,input.correlationId,input.reviewExecutionId,input.reviewArtifactId,input.writerArtifactId,input.seoArtifactId,input.brandArtifactId,input.status,input.reviewStatus,input.summary,JSON.stringify(input.findings),JSON.stringify(input.recommendations),input.createdAt]);
    const row=await this.pool.query(`SELECT * FROM review_revision_tasks WHERE workflow_id=$1 AND review_artifact_id=$2`,[input.workflowId,input.reviewArtifactId]);
    if(!row.rows[0])throw new Error("REVIEW_REVISION_TASK_PERSISTENCE_FAILED");
    return revisionTask(row.rows[0]);
  }
  async getReviewRevisionTask(taskId:string):Promise<ReviewRevisionTask|null>{const q=await this.pool.query(`SELECT * FROM review_revision_tasks WHERE task_id=$1`,[taskId]);return q.rowCount?revisionTask(q.rows[0]):null;}
  /** Settle an in-flight revision cycle. Idempotent: a settled task is never re-transitioned. */
  async settleReviewRevisionTask(input:{taskId:string;status:"COMPLETED"|"FAILED";completedAt:string}):Promise<ReviewRevisionTask|null>{
    await this.pool.query(`UPDATE review_revision_tasks SET status=$2,completed_at=$3 WHERE task_id=$1 AND status IN ('AUTHORIZED','IN_PROGRESS')`,[input.taskId,input.status,input.completedAt]);
    return this.getReviewRevisionTask(input.taskId);
  }
  async listReviewRevisionTasks(projectId:string):Promise<ReviewRevisionTask[]>{const q=await this.pool.query(`SELECT * FROM review_revision_tasks WHERE project_id=$1 ORDER BY created_at DESC`,[projectId]);return q.rows.map(revisionTask);}
  async listApprovals(projectId:string):Promise<ApprovalRecord[]>{const q=await this.pool.query(`SELECT * FROM control_approvals WHERE project_id=$1 ORDER BY created_at DESC`,[projectId]);return q.rows.map(approval);}
  async saveCommand(record:any):Promise<void>{await this.pool.query(`INSERT INTO control_commands (command_id,project_id,mode,owner_message,selected_agents,context,task_classification,workflow_id,status,visible_result,synthesis,artifact_refs,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)`,[record.commandId,record.projectId,record.mode,record.ownerMessage,JSON.stringify(record.selectedAgents),JSON.stringify(record.context),record.taskClassification,record.workflowId,record.status,record.visibleResult?JSON.stringify(record.visibleResult):null,record.synthesis?JSON.stringify(record.synthesis):null,JSON.stringify(record.artifactRefs),record.createdAt]);}
  async listCommands(projectId:string):Promise<any[]>{const q=await this.pool.query(`SELECT * FROM control_commands WHERE project_id=$1 ORDER BY created_at DESC`,[projectId]);return q.rows.map(r=>({...r,selectedAgents:parse(r.selected_agents),context:parse(r.context),visibleResult:r.visible_result&&parse(r.visible_result),synthesis:r.synthesis&&parse(r.synthesis),artifactRefs:parse(r.artifact_refs)}));}
  async updateCommand(commandId:string,input:{status:string;visibleResult?:unknown;synthesis?:unknown;artifactRefs?:unknown[]}):Promise<void>{await this.pool.query(`UPDATE control_commands SET status=$2,visible_result=COALESCE($3,visible_result),synthesis=COALESCE($4,synthesis),artifact_refs=COALESCE($5,artifact_refs),updated_at=$6 WHERE command_id=$1`,[commandId,input.status,input.visibleResult===undefined?null:JSON.stringify(input.visibleResult),input.synthesis===undefined?null:JSON.stringify(input.synthesis),input.artifactRefs===undefined?null:JSON.stringify(input.artifactRefs),new Date().toISOString()]);}
  async telemetry(projectId:string):Promise<any[]>{const q=await this.pool.query(`SELECT sub.command_context->>'commandId' AS command_id, sub.workflow_id, sub.status AS workflow_status, ep.execution_id, ep.agent_id, CASE ep.status WHEN 'success' THEN 'COMPLETED' WHEN 'failed' THEN 'FAILED' WHEN 'blocked' THEN 'BLOCKED' ELSE upper(ep.status) END AS execution_status, ep.provider, ep.model AS actual_model, ep.configuration->>'requestedModel' AS requested_model, ep.configuration->>'configSource' AS config_source, ep.runtime, ep.started_at, ep.completed_at, ep.artifact_ids, ep.error_classification, ep.cost, ep.cost_kind, ep.currency, ep.strategic_snapshot_id FROM workflow_submissions sub JOIN execution_provenance ep ON ep.workflow_id=sub.workflow_id WHERE sub.brand_id=$1 ORDER BY ep.started_at DESC`,[projectId]);return q.rows.map(r=>({...r,artifactRefs:parse(r.artifact_ids)}));}
  async reports(projectId:string):Promise<any[]>{const q=await this.pool.query(`SELECT a.artifact_id,a.workflow_id,a.kind,a.producer_agent,a.status,a.payload,a.content_type,a.schema_version,a.created_at FROM workflow_submissions sub JOIN artifacts a ON a.workflow_id=sub.workflow_id WHERE sub.brand_id=$1 ORDER BY a.created_at DESC`,[projectId]);return q.rows.map(r=>({...r,payload:parse(r.payload)}));}
  async saveConfigurationEvent(input:{scopeType:"PROJECT"|"AGENT";scopeId:string;provider:string|null;model:string|null;action:"SET"|"RESET";rationale:string}):Promise<void>{await this.pool.query(`INSERT INTO control_configuration_events (event_id,scope_type,scope_id,provider,model,action,rationale,previous_value,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[`config-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,input.scopeType,input.scopeId,input.provider,input.model,input.action,input.rationale,null,new Date().toISOString()]);}
  async effectiveConfiguration(projectId:string,agentId?:string):Promise<{provider:string|null;model:string|null;source:"GLOBAL"|"PROJECT"|"AGENT"|"UNCONFIGURED"}>{const project=await this.pool.query(`SELECT provider,model,action FROM control_configuration_events WHERE scope_type='PROJECT' AND scope_id=$1 ORDER BY created_at DESC LIMIT 1`,[projectId]);let value:{provider:string|null;model:string|null;source:"GLOBAL"|"PROJECT"|"AGENT"|"UNCONFIGURED"}={provider:null,model:null,source:"UNCONFIGURED"};if(project.rowCount&&project.rows[0].action==='SET')value={provider:project.rows[0].provider,model:project.rows[0].model,source:"PROJECT"};if(agentId){const agent=await this.pool.query(`SELECT provider,model,action FROM control_configuration_events WHERE scope_type='AGENT' AND scope_id=$1 ORDER BY created_at DESC LIMIT 1`,[`${projectId}:${agentId}`]);if(agent.rowCount&&agent.rows[0].action==='SET')value={provider:agent.rows[0].provider,model:agent.rows[0].model,source:"AGENT"};}return value;}
  async agentConfigurationMap(projectId:string):Promise<Record<string,{provider:string|null;model:string|null;source:string}>>{const result:Record<string,{provider:string|null;model:string|null;source:string}>={};const project=await this.effectiveConfiguration(projectId);if(project.source==='PROJECT')result['*']={...project};const rows=await this.pool.query(`SELECT DISTINCT ON (scope_id) scope_id,provider,model,action FROM control_configuration_events WHERE scope_type='AGENT' AND scope_id LIKE $1 ORDER BY scope_id,created_at DESC`,[`${projectId}:%`]);for(const r of rows.rows)if(r.action==='SET')result[String(r.scope_id).slice(projectId.length+1)]={provider:r.provider,model:r.model,source:'AGENT'};return result;}

  // -------------------------------------------------------------------------
  // Human-gate governance (Media Pipeline Pre-Approval Readiness V1).
  // Owner-action-only configuration with durable audit. Resolution:
  // PROJECT override -> GLOBAL setting -> built-in default (TRUE).
  // -------------------------------------------------------------------------

  /** Raw stored setting for an exact scope (null = no row = inherit). */
  async getHumanGateSetting(scopeType:HumanGateScopeType,scopeId:string,gateKey:HumanGateKey):Promise<HumanGateSetting|null>{
    const q=await this.pool.query(`SELECT * FROM human_gate_settings WHERE scope_type=$1 AND scope_id=$2 AND gate_key=$3`,[scopeType,scopeId,gateKey]);
    return q.rowCount?gateSetting(q.rows[0]):null;
  }

  /**
   * Effective human-gate policy for a project. The policy is a snapshot of
   * the resolution at call time: callers persist it with their routing
   * decision so the workflow remains reproducible after later changes.
   */
  async effectiveHumanGatePolicy(projectId:string|null):Promise<EffectiveHumanGatePolicy>{
    const resolvedAt=new Date().toISOString();
    let resolvedScope:"PROJECT"|"GLOBAL"|"DEFAULT"="DEFAULT";
    let preProductionEnabled=HUMAN_GATE_DEFAULT_ENABLED;
    let visualHumanGateEnabled=HUMAN_GATE_DEFAULT_ENABLED;
    const globalPre=await this.getHumanGateSetting("GLOBAL","*", "pre_production");
    const globalVisual=await this.getHumanGateSetting("GLOBAL","*","visual");
    if(globalPre)preProductionEnabled=globalPre.enabled;
    if(globalVisual)visualHumanGateEnabled=globalVisual.enabled;
    if(globalPre||globalVisual)resolvedScope="GLOBAL";
    if(projectId){
      const projectPre=await this.getHumanGateSetting("PROJECT",projectId,"pre_production");
      const projectVisual=await this.getHumanGateSetting("PROJECT",projectId,"visual");
      if(projectPre)preProductionEnabled=projectPre.enabled;
      if(projectVisual)visualHumanGateEnabled=projectVisual.enabled;
      if(projectPre||projectVisual)resolvedScope="PROJECT";
    }
    const version=await this.pool.query(
      `SELECT count(*)::int AS n FROM human_gate_configuration_events WHERE (scope_type='PROJECT' AND scope_id=$1) OR scope_type='GLOBAL'`,
      [projectId??""],
    );
    return {preProductionEnabled,visualHumanGateEnabled,resolvedScope,configurationVersion:Number(version.rows[0].n),resolvedAt};
  }

  /**
   * Owner-authorized human-gate configuration change (set or reset).
   * Append-only audit; the previous row value is captured as old_value.
   * Returns the durable audit event.
   */
  async setHumanGateSetting(input:{gateKey:HumanGateKey;scopeType:HumanGateScopeType;scopeId:string;enabled:boolean;changedBy:string;rationale:string;correlationId?:string|null}):Promise<HumanGateConfigurationEvent>{
    if(!HUMAN_GATE_KEYS.includes(input.gateKey))throw new Error("HUMAN_GATE_KEY_INVALID");
    if(input.scopeType==="PROJECT"&&(!input.scopeId||input.scopeId==="*"))throw new Error("HUMAN_GATE_PROJECT_SCOPE_REQUIRED");
    const previous=await this.getHumanGateSetting(input.scopeType,input.scopeId,input.gateKey);
    const updatedAt=new Date().toISOString();
    await this.pool.query(
      `INSERT INTO human_gate_settings (scope_type,scope_id,gate_key,enabled,updated_by,updated_at) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (scope_type,scope_id,gate_key) DO UPDATE SET enabled=$4,updated_by=$5,updated_at=$6`,
      [input.scopeType,input.scopeId,input.gateKey,input.enabled,input.changedBy,updatedAt],
    );
    return this.appendHumanGateEvent(input.gateKey,input.scopeType,input.scopeId,previous?{enabled:previous.enabled}:null,{enabled:input.enabled},input.changedBy,input.rationale,input.correlationId??null);
  }

  /** Reset a scope's override so it inherits again (GLOBAL reset = return to built-in default). */
  async resetHumanGateSetting(input:{gateKey:HumanGateKey;scopeType:HumanGateScopeType;scopeId:string;changedBy:string;rationale:string;correlationId?:string|null}):Promise<HumanGateConfigurationEvent>{
    const previous=await this.getHumanGateSetting(input.scopeType,input.scopeId,input.gateKey);
    await this.pool.query(`DELETE FROM human_gate_settings WHERE scope_type=$1 AND scope_id=$2 AND gate_key=$3`,[input.scopeType,input.scopeId,input.gateKey]);
    return this.appendHumanGateEvent(input.gateKey,input.scopeType,input.scopeId,previous?{enabled:previous.enabled}:null,null,input.changedBy,input.rationale,input.correlationId??null);
  }

  /** Effective settings view for the Control Platform (per gate: value, scope, inherited, last change). */
  async humanGateSettingsView(projectId:string):Promise<{gates:Array<{gateKey:HumanGateKey;enabled:boolean;scope:"PROJECT"|"GLOBAL"|"DEFAULT";inherited:boolean;lastChangedAt:string|null;lastChangedBy:string|null}>}>{
    const gates=[] as any[];
    for(const gateKey of HUMAN_GATE_KEYS){
      const project=await this.getHumanGateSetting("PROJECT",projectId,gateKey);
      const global=await this.getHumanGateSetting("GLOBAL","*",gateKey);
      const effective=project??global;
      gates.push({
        gateKey,
        enabled:effective?effective.enabled:HUMAN_GATE_DEFAULT_ENABLED,
        scope:project?"PROJECT":global?"GLOBAL":"DEFAULT",
        inherited:project===null,
        lastChangedAt:effective?effective.updatedAt:null,
        lastChangedBy:effective?effective.updatedBy:null,
      });
    }
    return {gates};
  }

  async listHumanGateConfigurationEvents(scopeId:string):Promise<HumanGateConfigurationEvent[]>{
    const q=await this.pool.query(`SELECT * FROM human_gate_configuration_events WHERE scope_id=$1 OR scope_type='GLOBAL' ORDER BY changed_at DESC LIMIT 100`,[scopeId]);
    return q.rows.map(gateEvent);
  }

  // -------------------------------------------------------------------------
  // Control Platform Operationalization V1: read models over canonical state.
  // All methods are read-only projections; no schema change, no side effects.
  // UNKNOWN cost semantics are preserved (null cost stays null, never zero).
  // -------------------------------------------------------------------------

  /** Positive membership: registered business projects with joined workflow/activity stats. Operational rows alone never create entries. */
  async listProjects():Promise<Array<{projectId:string; displayName:string; status:string; workflowCount:number; latestWorkflowId:string|null; latestStatus:string|null; pendingApprovals:number; lastActivityAt:string|null; contentCount:number; channelCount:number}>>{
    const q=await this.pool.query(
      `SELECT p.project_id, p.display_name, p.status,
              COUNT(DISTINCT sub.workflow_id)::int AS workflow_count,
              MAX(sub.created_at) AS last_activity_at
         FROM control_projects p
         LEFT JOIN workflow_submissions sub ON sub.brand_id = p.project_id
        GROUP BY p.project_id, p.display_name, p.status ORDER BY p.project_id`);
    const out: Array<{projectId:string; displayName:string; status:string; workflowCount:number; latestWorkflowId:string|null; latestStatus:string|null; pendingApprovals:number; lastActivityAt:string|null; contentCount:number; channelCount:number}> = [];
    for(const r of q.rows){
      const pid: string = r.project_id;
      // ASK/MULTI command executions are Q&A, not content workflows: they must
      // never hijack latest-workflow selection (proven when a live ASK became
      // the project's "latest workflow"). START_GOVERNED_TASK rows stay.
      const latest = await this.pool.query(`SELECT workflow_id, status, created_at FROM workflow_submissions WHERE brand_id=$1 AND (command_context IS NULL OR command_context->>'commandType' NOT IN ('ASK_AGENT','MULTI_AGENT_REVIEW')) ORDER BY created_at DESC LIMIT 1`,[pid]);
      const pend = await this.pool.query(`SELECT count(*)::int AS n FROM control_approvals WHERE project_id=$1 AND status<>'DECIDED'`,[pid]);
      let contentCount = 0;
      let channelCount = 0;
      try {
        const cc = await this.pool.query(`SELECT count(*)::int AS n FROM content_items WHERE project_id=$1`, [pid]);
        contentCount = Number(cc.rows[0]?.n ?? 0);
      } catch { /* content domain optional on legacy deployments */ }
      try {
        const ch = await this.pool.query(`SELECT count(*)::int AS n FROM channels WHERE project_id=$1`, [pid]);
        channelCount = Number(ch.rows[0]?.n ?? 0);
      } catch { /* channel domain optional on legacy deployments */ }
      out.push({projectId: pid, displayName: String(r.display_name ?? pid), status: String(r.status ?? "ACTIVE"), workflowCount: Number(r.workflow_count ?? 0), latestWorkflowId: latest.rows[0]?.workflow_id ?? null, latestStatus: latest.rows[0]?.status ?? null, pendingApprovals: Number(pend.rows[0]?.n ?? 0), lastActivityAt: r.last_activity_at ?? latest.rows[0]?.created_at ?? null, contentCount, channelCount});
    }
    return out;
  }

  /** Explicit business-project registration (positive Hub membership). Idempotent. */
  async registerProject(input:{projectId:string; displayName?:string; createdBy?:string; metadata?: Record<string, unknown>}):Promise<{project:{projectId:string; displayName:string; status:string}; created:boolean}>{
    const projectId = String(input.projectId ?? "").trim();
    if(!projectId) throw new Error("CONTROL_PROJECT_ID_REQUIRED");
    if(projectId.length > 200) throw new Error("CONTROL_PROJECT_ID_TOO_LONG");
    if(!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(projectId)) throw new Error("CONTROL_PROJECT_ID_INVALID");
    const displayName = String(input.displayName ?? projectId).trim() || projectId;
    if(displayName.length > 200) throw new Error("CONTROL_PROJECT_NAME_TOO_LONG");
    const createdBy = String(input.createdBy ?? "owner").slice(0, 200) || "owner";
    const now = new Date().toISOString();
    const ins = await this.pool.query(
      `INSERT INTO control_projects (project_id,display_name,status,created_by,created_at,metadata,updated_at)
       VALUES ($1,$2,'ACTIVE',$3,$4,$5,$4) ON CONFLICT (project_id) DO NOTHING`,
      [projectId, displayName, createdBy, now, JSON.stringify(input.metadata ?? {})]);
    const row = await this.pool.query(`SELECT project_id, display_name, status FROM control_projects WHERE project_id=$1`,[projectId]);
    return {
      project: { projectId: String(row.rows[0].project_id), displayName: String(row.rows[0].display_name), status: String(row.rows[0].status) },
      created: (ins.rowCount ?? 0) > 0,
    };
  }

  /** Project lifecycle transition. No destructive deletion: archival only. */
  async setProjectStatus(projectId:string, status:"DRAFT"|"ACTIVE"|"PAUSED"|"ARCHIVED"):Promise<{projectId:string; status:string}|null>{
    if(!["DRAFT","ACTIVE","PAUSED","ARCHIVED"].includes(status)) throw new Error("CONTROL_PROJECT_STATUS_INVALID");
    if(projectId === "morroway" && status !== "ACTIVE") throw new Error("CONTROL_PROJECT_MORROWAY_PINNED_ACTIVE");
    const now = new Date().toISOString();
    const q = await this.pool.query(
      `UPDATE control_projects SET status=$2,updated_at=$3 WHERE project_id=$1 RETURNING project_id,status`,
      [projectId, status, now]);
    if(!q.rowCount) return null;
    return { projectId: String(q.rows[0].project_id), status: String(q.rows[0].status) };
  }

  /** Canonical registry lookup (null when never registered — not an error). */
  async getProject(projectId:string):Promise<{projectId:string; displayName:string; status:string}|null>{
    const q=await this.pool.query(`SELECT project_id, display_name, status FROM control_projects WHERE project_id=$1`,[projectId]);
    if(!q.rowCount) return null;
    return { projectId: String(q.rows[0].project_id), displayName: String(q.rows[0].display_name), status: String(q.rows[0].status) };
  }

  /** Bounded workflow list for a project (newest first). */
  async listWorkflows(projectId:string, limit=20):Promise<Array<{workflowId:string; directive:string; correlationId:string|null; status:string; createdAt:string; updatedAt:string}>>{
    const n = Math.min(Math.max(limit, 1), 100);
    const q=await this.pool.query(`SELECT workflow_id, directive, correlation_id, status, created_at, updated_at FROM workflow_submissions WHERE brand_id=$1 AND (command_context IS NULL OR command_context->>'commandType' NOT IN ('ASK_AGENT','MULTI_AGENT_REVIEW')) ORDER BY created_at DESC LIMIT ${n}`,[projectId]);
    return q.rows.map((r:any)=>({workflowId:r.workflow_id, directive:r.directive, correlationId:r.correlation_id, status:r.status, createdAt:r.created_at, updatedAt:r.updated_at}));
  }

  /** Queue + worker + DB health projection. Never fabricates green: UNKNOWN when unmeasurable. */
  async platformHealth():Promise<{db:string; queue:{queued:number; running:number; succeeded:number; failed:number}; workers:{liveCount:number; latestHeartbeatAt:string|null; buildIds:string[]; stale:boolean}; recentFailures:Array<{jobId:number; workflowId:string; error:string|null; updatedAt:string}>}>{
    await this.pool.query(`SELECT 1`);
    const qc=await this.pool.query(`SELECT status, count(*)::int AS n FROM workflow_jobs GROUP BY status`);
    const counts:{queued:number; running:number; succeeded:number; failed:number}={queued:0, running:0, succeeded:0, failed:0};
    for(const r of qc.rows){ if(r.status in counts) (counts as any)[r.status]=Number(r.n); }
    let workers={liveCount:0, latestHeartbeatAt:null as string|null, buildIds:[] as string[], stale:true};
    let recentFailures:Array<{jobId:number; workflowId:string; error:string|null; updatedAt:string}>=[];
    try{
      const w=await this.pool.query(`SELECT worker_instance_id, build_id, last_heartbeat_at FROM amf_worker_presence WHERE runtime_mode='PERSISTENT_PRODUCTION_WORKER' ORDER BY last_heartbeat_at DESC LIMIT 5`);
      const now=Date.now();
      const live=w.rows.filter((r:any)=>{ const t=Date.parse(r.last_heartbeat_at); return Number.isFinite(t) && now-t<=300000; });
      workers={liveCount: live.length, latestHeartbeatAt: w.rows[0]?.last_heartbeat_at ?? null, buildIds: [...new Set(w.rows.map((r:any)=>String(r.build_id)))], stale: live.length===0};
    }catch{ workers={liveCount:0, latestHeartbeatAt:null, buildIds:[], stale:true}; }
    try{
      const f=await this.pool.query(`SELECT job_id, workflow_id, error, updated_at FROM workflow_jobs WHERE status='failed' ORDER BY updated_at DESC LIMIT 10`);
      recentFailures=f.rows.map((r:any)=>({jobId:Number(r.job_id), workflowId:r.workflow_id, error:r.error, updatedAt:r.updated_at}));
    }catch{ recentFailures=[]; }
    return {db:"ok", queue:counts, workers, recentFailures};
  }

  /** Cost summary preserving UNKNOWN: nulls are counted, never summed as zero. */
  async costSummary(projectId:string):Promise<{knownTotal:number; knownCurrency:string|null; knownCount:number; freeCount:number; unknownCount:number; byKind:Record<string,number>}>{
    const q=await this.pool.query(
      `SELECT ep.cost, ep.cost_kind, ep.currency FROM workflow_submissions sub JOIN execution_provenance ep ON ep.workflow_id=sub.workflow_id WHERE sub.brand_id=$1`,[projectId]);
    let knownTotal=0, knownCount=0, freeCount=0, unknownCount=0; const byKind:Record<string,number>={}; let currency:string|null=null;
    for(const r of q.rows){
      const kind=String(r.cost_kind ?? "UNKNOWN");
      byKind[kind]=(byKind[kind] ?? 0)+1;
      if(kind==="FREE"){ freeCount++; continue; }
      if(r.cost===null || r.cost===undefined || kind==="UNKNOWN"){ unknownCount++; continue; }
      const v=Number(r.cost); if(Number.isFinite(v)){ knownTotal+=v; knownCount++; currency=r.currency ?? currency; } else unknownCount++;
    }
    return {knownTotal, knownCurrency:currency, knownCount, freeCount, unknownCount, byKind};
  }

  /** Publication readiness derived from approvals + artifacts. Never authorizes publish. */
  async publicationReadiness(projectId:string, workflowId?:string):Promise<{workflowId:string|null; integrationValidation:string; productionApproval:string; publicPublishApproval:string; readyForExternalPublish:boolean; blockers:string[]; finalMediaArtifactId:string|null}>{
    let wf:string|null=workflowId ?? null;
    if(!wf){
      const latest=await this.pool.query(`SELECT workflow_id FROM workflow_submissions WHERE brand_id=$1 AND (command_context IS NULL OR command_context->>'commandType' NOT IN ('ASK_AGENT','MULTI_AGENT_REVIEW')) ORDER BY created_at DESC LIMIT 1`,[projectId]);
      wf=latest.rows[0]?.workflow_id ?? null;
    }
    if(!wf) return {workflowId:null, integrationValidation:"UNKNOWN", productionApproval:"UNKNOWN", publicPublishApproval:"UNKNOWN", readyForExternalPublish:false, blockers:["NO_WORKFLOW"], finalMediaArtifactId:null};
    const approvals=await this.pool.query(`SELECT target_type, target_id, status, owner_decision FROM control_approvals WHERE project_id=$1 AND target_id LIKE $2`,[projectId, `%${wf}%`]);
    const arts=await this.pool.query(`SELECT artifact_id, kind FROM artifacts WHERE workflow_id=$1`,[wf]);
    const kinds=new Set(arts.rows.map((r:any)=>String(r.kind)));
    const finalMedia=arts.rows.find((r:any)=>String(r.kind)==="final_media_artifact")?.artifact_id ?? null;
    const findDecided=(pred:(t:string)=>boolean)=>approvals.rows.find((r:any)=>r.status==="DECIDED" && pred(String(r.target_type)));
    const findPending=(pred:(t:string)=>boolean)=>approvals.rows.find((r:any)=>r.status!=="DECIDED" && pred(String(r.target_type)));
    const integ=findDecided((t)=>t.includes("publication_integration_validation"));
    const prodDecided=approvals.rows.find((r:any)=>r.status==="DECIDED" && /production/.test(String(r.target_type))+""!=="" && /production_approval|production-approved/.test(String(r.target_id)));
    const pubDecided=approvals.rows.find((r:any)=>r.status==="DECIDED" && /public_publish|published/.test(String(r.target_id)));
    const blockers:string[]=[];
    let integrationValidation="UNKNOWN";
    if(integ) integrationValidation="PASS";
    else if(findPending((t)=>t.includes("publication_integration_validation"))) integrationValidation="PENDING";
    else if(kinds.has("publication_integration_validation")) integrationValidation="RECORDED_UNAPPROVED";
    else { integrationValidation="NOT_RECORDED"; blockers.push("INTEGRATION_VALIDATION_NOT_DECIDED"); }
    let productionApproval="NO";
    if(prodDecided) productionApproval="YES";
    else blockers.push("NO_PRODUCTION_APPROVAL");
    let publicPublishApproval="NO";
    if(pubDecided) publicPublishApproval="YES";
    else blockers.push("NO_PUBLIC_PUBLISH_APPROVAL");
    blockers.push("TARGET_ACCOUNT_NOT_RESOLVED");
    return {workflowId:wf, integrationValidation, productionApproval, publicPublishApproval, readyForExternalPublish:false, blockers, finalMediaArtifactId:finalMedia};
  }

  /** Configuration event history (bounded, newest first). */
  async configurationHistory(projectId:string, agentId?:string, limit=20):Promise<Array<{eventId:string; scopeType:string; scopeId:string; provider:string|null; model:string|null; action:string; rationale:string; createdAt:string}>>{
    const n=Math.min(Math.max(limit,1),100);
    const like=`${projectId}:%`;
    const q=agentId
      ? await this.pool.query(`SELECT event_id, scope_type, scope_id, provider, model, action, rationale, created_at FROM control_configuration_events WHERE scope_id=$1 OR scope_id=$2 ORDER BY created_at DESC LIMIT ${n}`,[projectId, `${projectId}:${agentId}`])
      : await this.pool.query(`SELECT event_id, scope_type, scope_id, provider, model, action, rationale, created_at FROM control_configuration_events WHERE scope_id=$1 OR scope_id LIKE $2 ORDER BY created_at DESC LIMIT ${n}`,[projectId, like]);
    return q.rows.map((r:any)=>({eventId:r.event_id, scopeType:r.scope_type, scopeId:r.scope_id, provider:r.provider, model:r.model, action:r.action, rationale:r.rationale, createdAt:r.created_at}));
  }

  private async appendHumanGateEvent(gateKey:HumanGateKey,scopeType:HumanGateScopeType,scopeId:string,oldValue:{enabled:boolean}|null,newValue:{enabled:boolean}|null,changedBy:string,rationale:string,correlationId:string|null):Promise<HumanGateConfigurationEvent>{
    const eventId=`gate-cfg-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;
    await this.pool.query(
      `INSERT INTO human_gate_configuration_events (event_id,gate_key,scope_type,scope_id,old_value,new_value,changed_by,changed_at,source,rationale,correlation_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [eventId,gateKey,scopeType,scopeId,oldValue?JSON.stringify(oldValue):null,newValue?JSON.stringify(newValue):null,changedBy,new Date().toISOString(),"OWNER_CONTROL_PLANE_ACTION",rationale,correlationId],
    );
    const q=await this.pool.query(`SELECT * FROM human_gate_configuration_events WHERE event_id=$1`,[eventId]);
    return gateEvent(q.rows[0]);
  }

  /** Media Technical Resume V1: settle a durable resume outcome (idempotent). */
  async settleMediaResumeOutcome(input:{resumeId:string;outcome:"VISUAL_GATE_PENDING"|"COMPLETED"|"FAILED"}):Promise<void>{
    await this.pool.query(`UPDATE media_resume_dispatches SET outcome=$2 WHERE resume_id=$1 AND outcome IS NULL`,[input.resumeId,input.outcome]);
  }

  /**
   * Append evidence references to a PENDING approval without replacing
   * history. Additive + deduplicated; refuses DECIDED rows (decided history
   * is immutable — a versioned replacement gate is required instead).
   * Used to point the visual prompt gate at superseding creative material.
   */
  async appendApprovalEvidence(approvalId:string,evidenceRefs:readonly string[]):Promise<ApprovalRecord|null>{
    const existing=await this.getApproval(approvalId);
    if(!existing)throw new Error("APPROVAL_NOT_FOUND");
    if(existing.status!=="PENDING")throw new Error("APPROVAL_EVIDENCE_FROZEN:DECIDED");
    const merged=[...existing.evidenceRefs];
    for(const ref of evidenceRefs){ if(typeof ref==="string"&&ref.length>0&&!merged.includes(ref))merged.push(ref); }
    await this.pool.query(`UPDATE control_approvals SET evidence_refs=$2 WHERE approval_id=$1`,[approvalId,JSON.stringify(merged)]);
    return this.getApproval(approvalId);
  }
}
