import { createHash, randomUUID } from "node:crypto";
import type pg from "pg";

export const PROGRAM_05_NORMAL_OPERATIONS = [
  "project_onboarding", "channel_onboarding", "credential_binding", "routing_change",
  "budget_change", "owner_approval", "recovery_authorization", "credential_health",
  "worker_lifecycle", "private_publication", "analytics_observation", "learning_review",
  "next_cycle_decision",
] as const;

export const PROGRAM_05_BREAK_GLASS_OPERATIONS = [
  "schema_migration", "accounting_repair", "historical_output_import",
  "provider_deployment", "artifact_integrity_repair",
] as const;

export type NextCycleOwnerDecision = "APPROVE" | "REJECT" | "DEFER" | "REQUEST_CHANGES";
export type CredentialHealthAction = "VERIFY_HEALTH" | "REFRESH_AND_VERIFY";
export type CredentialHealthState = "VALID" | "EXPIRED" | "REVOKED" | "INSUFFICIENT_SCOPE" |
  "CHANNEL_IDENTITY_MISMATCH" | "UNKNOWN_REQUIRES_REFRESH" | "AUTH_REQUIRED" | "ERROR";
export interface CredentialHealthTransportEvent {
  stage: "CREDENTIAL_REF_RESOLVED" | "TOKEN_FILE_READ" | "SCOPE_VALIDATION" |
    "OAUTH_REFRESH" | "YOUTUBE_IDENTITY" | "CHANNEL_IDENTITY_VALIDATION";
  outcome: "STARTED" | "SUCCEEDED" | "FAILED";
  at: string;
  httpStatus?: number;
  providerErrorCode?: string;
  errorClass?: string;
  retryable?: boolean;
}
export interface SafeCredentialHealthResult {
  state: CredentialHealthState;
  scopeState: "PASS" | "FAIL" | "UNKNOWN";
  channelIdentityState: "MATCH" | "MISMATCH" | "UNKNOWN";
  verifiedExternalChannelId?: string | null;
  reasonCode?: string | null;
  evidenceFingerprint: string;
  verifiedAt: string;
  freshUntil: string;
  transportLedger?: CredentialHealthTransportEvent[];
}

const json = (value: unknown): Record<string, unknown> => {
  if (typeof value === "string") {
    try { return json(JSON.parse(value)); } catch { return {}; }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
};

function id(prefix: string, parts: unknown[]): string {
  return `${prefix}-${createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16)}`;
}

export class OwnerAutonomyStore {
  constructor(private readonly pool: pg.Pool) {}

  private async project(projectId: string, client: pg.Pool | pg.PoolClient = this.pool) {
    const q = await client.query(`SELECT project_id,display_name,status,metadata,created_at,updated_at FROM control_projects WHERE project_id=$1`, [projectId]);
    if (!q.rowCount) throw new Error("PROJECT_NOT_FOUND");
    return q.rows[0];
  }

  private async audit(input: {
    projectId: string; action: string; subjectType: string; subjectId: string;
    actor: string; reason: string; before?: unknown; after?: unknown;
    metadata?: Record<string, unknown>;
  }, client: pg.Pool | pg.PoolClient = this.pool) {
    const eventId = `owner-event-${randomUUID()}`;
    const createdAt = new Date().toISOString();
    await client.query(
      `INSERT INTO owner_control_audit_events(event_id,project_id,action,subject_type,subject_id,actor,reason,before_state,after_state,metadata,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [eventId, input.projectId, input.action, input.subjectType, input.subjectId, input.actor,
        input.reason, input.before === undefined ? null : JSON.stringify(input.before),
        input.after === undefined ? null : JSON.stringify(input.after), JSON.stringify(input.metadata ?? {}), createdAt],
    );
    return { eventId, createdAt };
  }

  async auditEvents(projectId: string, limit = 100) {
    await this.project(projectId);
    const n = Math.min(Math.max(limit, 1), 200);
    const q = await this.pool.query(`SELECT * FROM owner_control_audit_events WHERE project_id=$1 ORDER BY created_at DESC LIMIT ${n}`, [projectId]);
    return q.rows.map((r: any) => ({
      eventId: r.event_id, projectId: r.project_id, action: r.action,
      subjectType: r.subject_type, subjectId: r.subject_id, actor: r.actor,
      reason: r.reason, before: r.before_state === null ? null : json(r.before_state),
      after: r.after_state === null ? null : json(r.after_state), metadata: json(r.metadata), createdAt: r.created_at,
    }));
  }

  async recordOwnerAction(input: { projectId:string; action:string; subjectType:string; subjectId:string; actor:string; reason:string; before?:unknown; after?:unknown; metadata?:Record<string,unknown> }) {
    await this.project(input.projectId);
    return this.audit(input);
  }

  async onboarding(projectId: string) {
    const project = await this.project(projectId);
    const channels = await this.pool.query(`SELECT channel_id,platform,external_channel_id,status FROM channels WHERE project_id=$1 ORDER BY created_at`, [projectId]);
    const bindings = await this.pool.query(`SELECT binding_id,channel_id,provider,status FROM credential_bindings WHERE project_id=$1 ORDER BY created_at`, [projectId]);
    const health = await this.pool.query(`SELECT binding_id,health_state,fresh_until FROM credential_binding_health WHERE project_id=$1`, [projectId]);
    const routing = await this.pool.query(`SELECT routing_version_id,profile,activated_at FROM production_model_routing_versions WHERE project_id=$1 AND scope_type='PROJECT' AND active`, [projectId]);
    const budgets = await this.pool.query(`SELECT phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active FROM production_phase_call_budgets WHERE project_id=$1 ORDER BY phase,call_kind`, [projectId]);
    const automation = await this.pool.query(`SELECT enabled,level,publication_policy,next_cycle_policy FROM automation_policies WHERE project_id=$1`, [projectId]);
    const hasActiveBinding = bindings.rows.some((r: any) => r.status === "ACTIVE");
    const freshHealth = new Map(health.rows.map((r:any)=>[r.binding_id,r]));
    const hasValidFreshCredential = bindings.rows.some((r:any)=>{
      const h:any=freshHealth.get(r.binding_id);return r.status==="ACTIVE"&&h?.health_state==="VALID"&&Date.parse(h.fresh_until)>Date.now();
    });
    const automationState = automation.rowCount
      ? { enabled: automation.rows[0].enabled === true, level: automation.rows[0].level, publicationPolicy: automation.rows[0].publication_policy, nextCyclePolicy: automation.rows[0].next_cycle_policy }
      : { enabled: false, level: "L0_MANUAL", publicationPolicy: "OWNER_APPROVAL_REQUIRED", nextCyclePolicy: "OWNER_START_ONLY" };
    const checks = {
      projectIdentity: true,
      channelBinding: (channels.rowCount ?? 0) > 0,
      credentialBinding: hasActiveBinding,
      credentialHealth: hasValidFreshCredential,
      routingActive: (routing.rowCount ?? 0) > 0,
      budgetsConfigured: (budgets.rowCount ?? 0) > 0,
      // The absence of an override intentionally resolves to the safe canonical
      // default. L0 manual is an operationally ready policy, not an onboarding
      // failure and never enables automation.
      automationPolicy: automationState.enabled === false && automationState.level === "L0_MANUAL"
        || (automation.rowCount ?? 0) > 0,
    };
    const cycleBudgets=new Map(budgets.rows.filter((r:any)=>r.phase==="MORROWAY_PRODUCTION_CYCLE_01_PRE_MEDIA").map((r:any)=>[r.call_kind,r]));
    const cycleBudgetReady=(kind:string,needed:number)=>{const r:any=cycleBudgets.get(kind);return r?.active===true&&Number(r.limit_count)-Number(r.reserved_count)-Number(r.consumed_count)>=needed&&Number(r.max_retries)===0};
    const contentPremediaBudgetReady=cycleBudgetReady("research",4)&&cycleBudgetReady("text_agent",10)&&cycleBudgetReady("image_generation",1);
    // Generic per-phase readiness over every Owner-authorized budget envelope
    // present for the project (legacy phases plus explicit canary/cycle
    // phases). Each phase is evaluated against the canonical pre-media
    // minimums; this map is additive and never alters the legacy capability
    // fields below.
    const phaseNeeds:ReadonlyArray<readonly [string,number]>=[["research",4],["text_agent",10],["image_generation",1]];
    const byPhase=new Map<string,any[]>();
    for(const r of budgets.rows as any[]){const list=byPhase.get(r.phase)??[];list.push(r);byPhase.set(r.phase,list);}
    const budgetPhaseReadiness=[...byPhase.entries()].map(([phase,rows])=>{
      const byKind=new Map(rows.map((r:any)=>[r.call_kind,r]));
      const reasons:string[]=[];
      for(const [kind,needed] of phaseNeeds){
        const r:any=byKind.get(kind);
        if(!(r?.active===true&&Number(r.limit_count)-Number(r.reserved_count)-Number(r.consumed_count)>=needed&&Number(r.max_retries)===0))reasons.push(`BUDGET_${kind.toUpperCase()}_UNAVAILABLE`);
      }
      return { phase, ready:reasons.length===0, reasons };
    }).sort((a,b)=>a.phase.localeCompare(b.phase));
    const capabilityReadiness={
      contentProduction:{ready:project.status==="ACTIVE"&&checks.routingActive&&contentPremediaBudgetReady,credentialRequired:false,budgetPhase:"MORROWAY_PRODUCTION_CYCLE_01_PRE_MEDIA",reasons:[...(project.status==="ACTIVE"?[]:["PROJECT_INACTIVE"]),...(checks.routingActive?[]:["ROUTING_UNAVAILABLE"]),...(contentPremediaBudgetReady?[]:["CYCLE_01_PREMEDIA_BUDGET_UNAVAILABLE"])]},
      youtubePublication:{ready:checks.channelBinding&&checks.credentialBinding&&checks.credentialHealth,credentialRequired:true,reasons:checks.credentialHealth?[]:["YOUTUBE_CREDENTIAL_REFRESH_REQUIRED"]},
      youtubeAnalytics:{ready:checks.channelBinding&&checks.credentialBinding&&checks.credentialHealth,credentialRequired:true,reasons:checks.credentialHealth?[]:["YOUTUBE_CREDENTIAL_REFRESH_REQUIRED"]},
    };
    return {
      project: { projectId: project.project_id, displayName: project.display_name, status: project.status, metadata: json(project.metadata) },
      checks,
      ready: capabilityReadiness.contentProduction.ready,
      failClosedReasons: capabilityReadiness.contentProduction.reasons,
      capabilityReadiness,
      channels: channels.rows.map((r: any) => ({ channelId: r.channel_id, platform: r.platform, externalChannelId: r.external_channel_id, status: r.status })),
      credentialBindings: bindings.rows.map((r: any) => { const h:any=freshHealth.get(r.binding_id);return { bindingId: r.binding_id, channelId: r.channel_id, provider: r.provider, status: r.status, healthState:h?.health_state??"UNKNOWN_REQUIRES_REFRESH",fresh:Boolean(h?.health_state==="VALID"&&Date.parse(h.fresh_until)>Date.now()) }; }),
      activeRoutingVersionId: routing.rows[0]?.routing_version_id ?? null,
      budgets: budgets.rows.map((r: any) => ({ phase: r.phase, callKind: r.call_kind, limit: Number(r.limit_count), used: Number(r.consumed_count), reserved: Number(r.reserved_count), remaining: Number(r.limit_count)-Number(r.consumed_count)-Number(r.reserved_count), maxRetries: Number(r.max_retries), active: r.active === true })),
      budgetPhaseReadiness,
      automation: automationState,
    };
  }

  async routing(projectId: string) {
    await this.project(projectId);
    const q = await this.pool.query(
      `SELECT v.routing_version_id,v.profile,v.scope_type,v.project_id,v.active,v.activated_at,v.deactivated_at,v.provenance,
              COALESCE(jsonb_agg(jsonb_build_object('role',e.role,'primary',e.primary_model_id,'fallback',e.fallback_model_id,'economy',e.economy_model_id,'premiumEscalation',e.premium_escalation_model_id,'priceSnapshots',e.price_snapshot_ids,'evidence',e.evidence) ORDER BY e.role) FILTER (WHERE e.role IS NOT NULL),'[]'::jsonb) entries
         FROM production_model_routing_versions v LEFT JOIN production_model_routing_entries e ON e.routing_version_id=v.routing_version_id
        WHERE v.scope_type='PROJECT' AND v.project_id=$1 GROUP BY v.routing_version_id ORDER BY v.activated_at DESC NULLS LAST`, [projectId]);
    return q.rows.map((r: any) => ({ routingVersionId: r.routing_version_id, profile: r.profile, scope: r.scope_type, projectId: r.project_id, active: r.active === true, activatedAt: r.activated_at, deactivatedAt: r.deactivated_at, provenance: json(r.provenance), entries: Array.isArray(r.entries) ? r.entries : [] }));
  }

  /** Activate an already benchmark-backed, project-scoped routing version.
   * Program 5 does not mint an alternate route authority. */
  async activateRouting(input: { projectId: string; routingVersionId: string; actor: string; reason: string }) {
    if (!input.reason.trim()) throw new Error("OWNER_REASON_REQUIRED");
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN"); await this.project(input.projectId, c);
      const targetQ = await c.query(`SELECT * FROM production_model_routing_versions WHERE routing_version_id=$1 FOR UPDATE`, [input.routingVersionId]);
      if (!targetQ.rowCount) throw new Error("ROUTING_VERSION_NOT_FOUND");
      const target = targetQ.rows[0];
      if (target.scope_type !== "PROJECT" || target.project_id !== input.projectId) throw new Error("CROSS_PROJECT_DENIED");
      const entries = await c.query(`SELECT role,primary_model_id,fallback_model_id,economy_model_id,premium_escalation_model_id,price_snapshot_ids,evidence FROM production_model_routing_entries WHERE routing_version_id=$1 AND active ORDER BY role`, [input.routingVersionId]);
      if (!entries.rowCount) throw new Error("ROUTING_VERSION_EMPTY");
      const activeQ = await c.query(`SELECT routing_version_id FROM production_model_routing_versions WHERE scope_type='PROJECT' AND project_id=$1 AND active FOR UPDATE`, [input.projectId]);
      const before = activeQ.rows[0]?.routing_version_id ?? null;
      const now = new Date().toISOString();
      await c.query(`UPDATE production_model_routing_versions SET active=FALSE,deactivated_at=$2 WHERE scope_type='PROJECT' AND project_id=$1 AND active`, [input.projectId,now]);
      await c.query(`UPDATE production_model_routing_versions SET active=TRUE,activated_at=$2,deactivated_at=NULL,provenance=provenance||$3::jsonb WHERE routing_version_id=$1`, [input.routingVersionId,now,JSON.stringify({ ownerActivation: { actor:input.actor,reason:input.reason,at:now,previousRoutingVersionId:before } })]);
      const audit = await this.audit({ projectId: input.projectId, action: "ROUTING_ACTIVATE", subjectType: "production_routing", subjectId: input.routingVersionId, actor: input.actor, reason: input.reason, before: { routingVersionId:before }, after: { routingVersionId:input.routingVersionId }, metadata: { entryCount:entries.rowCount, authority:"production_model_routing_versions" } }, c);
      await c.query("COMMIT");
      return { routingVersionId:input.routingVersionId,previousRoutingVersionId:before,active:true,entryCount:entries.rowCount,audit };
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }

  async setBudget(input: { projectId: string; phase: string; callKind: string; limit: number; maxRetries: number; actor: string; reason: string }) {
    if (!Number.isInteger(input.limit) || input.limit < 0) throw new Error("BUDGET_LIMIT_INVALID");
    if (!Number.isInteger(input.maxRetries) || input.maxRetries < 0) throw new Error("BUDGET_RETRIES_INVALID");
    if (!input.reason.trim()) throw new Error("OWNER_REASON_REQUIRED");
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN"); await this.project(input.projectId, c);
      const beforeQ = await c.query(`SELECT * FROM production_phase_call_budgets WHERE project_id=$1 AND phase=$2 AND call_kind=$3 FOR UPDATE`, [input.projectId,input.phase,input.callKind]);
      const before = beforeQ.rows[0] ?? null;
      const reserved = Number(before?.reserved_count ?? 0), used = Number(before?.consumed_count ?? 0);
      if (reserved + used > input.limit) throw new Error("BUDGET_LIMIT_BELOW_CURRENT_EXPOSURE");
      const now = new Date().toISOString();
      await c.query(`INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at)
        VALUES($1,$2,$3,$4,0,0,$5,TRUE,$6)
        ON CONFLICT(project_id,phase,call_kind) DO UPDATE SET limit_count=$4,max_retries=$5,active=TRUE,updated_at=$6`, [input.projectId,input.phase,input.callKind,input.limit,input.maxRetries,now]);
      const after = (await c.query(`SELECT * FROM production_phase_call_budgets WHERE project_id=$1 AND phase=$2 AND call_kind=$3`, [input.projectId,input.phase,input.callKind])).rows[0];
      const audit = await this.audit({ projectId: input.projectId, action: "BUDGET_SET", subjectType: "production_budget", subjectId: `${input.phase}:${input.callKind}`, actor: input.actor, reason: input.reason, before, after, metadata: { executionAuthorityGranted: false } }, c);
      await c.query("COMMIT");
      return { budget: { phase: after.phase, callKind: after.call_kind, limit: Number(after.limit_count), used: Number(after.consumed_count), reserved: Number(after.reserved_count), remaining: Number(after.limit_count)-Number(after.consumed_count)-Number(after.reserved_count), maxRetries: Number(after.max_retries) }, audit };
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }

  async decideNextCycle(input: { projectId: string; proposalId: string; decision: NextCycleOwnerDecision; rationale: string; actor: string }) {
    if (!["APPROVE","REJECT","DEFER","REQUEST_CHANGES"].includes(input.decision)) throw new Error("NEXT_CYCLE_DECISION_INVALID");
    if (!input.rationale.trim()) throw new Error("OWNER_REASON_REQUIRED");
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const q = await c.query(`SELECT * FROM next_cycle_proposals WHERE proposal_id=$1 FOR UPDATE`, [input.proposalId]);
      if (!q.rowCount) throw new Error("NEXT_CYCLE_PROPOSAL_NOT_FOUND");
      const proposal = q.rows[0];
      if (proposal.project_id !== input.projectId) throw new Error("CROSS_PROJECT_DENIED");
      const decisionId = id("ncd", [input.projectId,input.proposalId,input.decision,input.rationale]);
      const createdAt = new Date().toISOString();
      const inserted = await c.query(`INSERT INTO next_cycle_owner_decisions(decision_id,proposal_id,project_id,decision,rationale,actor,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(proposal_id) DO NOTHING RETURNING *`, [decisionId,input.proposalId,input.projectId,input.decision,input.rationale,input.actor,createdAt]);
      const row = inserted.rowCount ? inserted.rows[0] : (await c.query(`SELECT * FROM next_cycle_owner_decisions WHERE proposal_id=$1`, [input.proposalId])).rows[0];
      if (row.decision !== input.decision || row.rationale !== input.rationale) throw new Error("NEXT_CYCLE_DECISION_IMMUTABLE");
      const status = input.decision === "APPROVE" ? "OWNER_APPROVED_AWAITS_EXPLICIT_START" : input.decision === "REJECT" ? "OWNER_REJECTED" : input.decision === "DEFER" ? "OWNER_DEFERRED" : "OWNER_REQUESTED_CHANGES";
      await c.query(`UPDATE next_cycle_proposals SET status=$2 WHERE proposal_id=$1 AND status='AWAITS_OWNER_DECISION'`, [input.proposalId,status]);
      const audit = await this.audit({ projectId: input.projectId, action: `NEXT_CYCLE_${input.decision}`, subjectType: "next_cycle_proposal", subjectId: input.proposalId, actor: input.actor, reason: input.rationale, before: { status: proposal.status }, after: { status }, metadata: { workflowCreated: false, executionStarted: false } }, c);
      await c.query("COMMIT");
      return { decision: { decisionId: row.decision_id, proposalId: row.proposal_id, projectId: row.project_id, decision: row.decision, rationale: row.rationale, actor: row.actor, createdAt: row.created_at }, nextCycleState: status, workflowCreated: false, audit };
    } catch (e) { await c.query("ROLLBACK"); throw e; } finally { c.release(); }
  }

  async nextCycle(projectId: string) {
    await this.project(projectId);
    const q = await this.pool.query(`SELECT p.*,d.decision_id,d.decision,d.rationale,d.actor,d.created_at AS decided_at FROM next_cycle_proposals p LEFT JOIN next_cycle_owner_decisions d ON d.proposal_id=p.proposal_id WHERE p.project_id=$1 ORDER BY p.created_at DESC`, [projectId]);
    return q.rows.map((r: any) => ({ proposalId:r.proposal_id,projectId:r.project_id,recommendationId:r.recommendation_id,summary:r.summary,status:r.status,createdAt:r.created_at,ownerDecision:r.decision?{decisionId:r.decision_id,decision:r.decision,rationale:r.rationale,actor:r.actor,decidedAt:r.decided_at}:null }));
  }

  /** Claim an idempotent health action and resolve its opaque credential
   * reference internally.  Callers MUST NOT serialize credentialReference. */
  async claimCredentialHealth(input: { projectId:string; bindingId:string; action:CredentialHealthAction; idempotencyKey:string; actor:string; reason:string }) {
    if (!input.reason.trim()) throw new Error("OWNER_REASON_REQUIRED");
    if (!input.idempotencyKey.trim()) throw new Error("IDEMPOTENCY_KEY_REQUIRED");
    if (!["VERIFY_HEALTH","REFRESH_AND_VERIFY"].includes(input.action)) throw new Error("CREDENTIAL_HEALTH_ACTION_INVALID");
    const c=await this.pool.connect();
    try {
      await c.query("BEGIN"); await this.project(input.projectId,c);
      const q=await c.query(`SELECT b.*,ch.external_channel_id,ch.platform,ch.status AS channel_status
        FROM credential_bindings b LEFT JOIN channels ch ON ch.channel_id=b.channel_id
        WHERE b.binding_id=$1 FOR UPDATE OF b`,[input.bindingId]);
      if(!q.rowCount)throw new Error("CREDENTIAL_BINDING_NOT_FOUND");
      const binding=q.rows[0];
      if(binding.project_id!==input.projectId)throw new Error("CROSS_PROJECT_DENIED");
      if(binding.status!=="ACTIVE")throw new Error("CREDENTIAL_BINDING_INACTIVE");
      if(!binding.channel_id||binding.channel_status!=="VERIFIED"||!binding.external_channel_id)throw new Error("CHANNEL_IDENTITY_NOT_READY");
      if(binding.provider!==binding.platform)throw new Error("CREDENTIAL_PROVIDER_CHANNEL_MISMATCH");
      const requestKey=id("credential-health-request",[input.projectId,input.bindingId,input.action,input.idempotencyKey]);
      const checkId=id("credential-health-check",[requestKey]); const now=new Date().toISOString();
      const inserted=await c.query(`INSERT INTO credential_health_checks(check_id,request_key,project_id,binding_id,channel_id,provider,action,status,actor,reason,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,'IN_PROGRESS',$8,$9,$10) ON CONFLICT(request_key) DO NOTHING RETURNING *`,
      [checkId,requestKey,input.projectId,input.bindingId,binding.channel_id,binding.provider,input.action,input.actor,input.reason,now]);
      if(!inserted.rowCount){
        const existing=(await c.query(`SELECT * FROM credential_health_checks WHERE request_key=$1`,[requestKey])).rows[0];
        await c.query("COMMIT");
        return {created:false,checkId:existing.check_id,status:existing.status,result:existing.result??null,target:null};
      }
      const previous=(await c.query(`SELECT health_state,scope_state,channel_identity_state,last_verified_at,fresh_until FROM credential_binding_health WHERE binding_id=$1`,[input.bindingId])).rows[0]??null;
      await c.query("COMMIT");
      return {created:true,checkId,status:"IN_PROGRESS",result:null,previous,target:{projectId:input.projectId,bindingId:input.bindingId,channelId:binding.channel_id,provider:binding.provider,credentialReference:binding.credential_ref,expectedExternalChannelId:binding.external_channel_id,action:input.action}};
    } catch(e){await c.query("ROLLBACK");throw e} finally{c.release()}
  }

  async completeCredentialHealth(input:{checkId:string;result:SafeCredentialHealthResult}) {
    if(!/^[a-f0-9]{32,128}$/i.test(input.result.evidenceFingerprint))throw new Error("CREDENTIAL_EVIDENCE_FINGERPRINT_INVALID");
    const c=await this.pool.connect();
    try{
      await c.query("BEGIN");
      const q=await c.query(`SELECT * FROM credential_health_checks WHERE check_id=$1 FOR UPDATE`,[input.checkId]);
      if(!q.rowCount)throw new Error("CREDENTIAL_HEALTH_CHECK_NOT_FOUND");
      const check=q.rows[0];
      if(check.status==="COMPLETED"){await c.query("COMMIT");return {replayed:true,health:check.result,audit:null}}
      const safe={state:input.result.state,scopeState:input.result.scopeState,channelIdentityState:input.result.channelIdentityState,verifiedExternalChannelId:input.result.verifiedExternalChannelId??null,reasonCode:input.result.reasonCode??null,evidenceFingerprint:input.result.evidenceFingerprint,verifiedAt:input.result.verifiedAt,freshUntil:input.result.freshUntil};
      await c.query(`INSERT INTO credential_binding_health(binding_id,project_id,channel_id,provider,health_state,scope_state,channel_identity_state,verified_external_channel_id,reason_code,evidence_fingerprint,last_verified_at,fresh_until,check_id,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$11)
        ON CONFLICT(binding_id) DO UPDATE SET health_state=$5,scope_state=$6,channel_identity_state=$7,verified_external_channel_id=$8,reason_code=$9,evidence_fingerprint=$10,last_verified_at=$11,fresh_until=$12,check_id=$13,updated_at=$11`,
      [check.binding_id,check.project_id,check.channel_id,check.provider,safe.state,safe.scopeState,safe.channelIdentityState,safe.verifiedExternalChannelId,safe.reasonCode,safe.evidenceFingerprint,safe.verifiedAt,safe.freshUntil,input.checkId]);
      await c.query(`UPDATE credential_health_checks SET status='COMPLETED',result=$2,completed_at=$3 WHERE check_id=$1`,[input.checkId,JSON.stringify(safe),safe.verifiedAt]);
      const audit=await this.audit({projectId:check.project_id,action:`CREDENTIAL_${check.action}`,subjectType:"credential_binding",subjectId:check.binding_id,actor:check.actor,reason:check.reason,before:null,after:{state:safe.state,scopeState:safe.scopeState,channelIdentityState:safe.channelIdentityState,lastVerifiedAt:safe.verifiedAt},metadata:{checkId:input.checkId,channelBindingId:check.channel_id,provider:check.provider,evidenceFingerprint:safe.evidenceFingerprint,secretMaterialPersisted:false}},c);
      await c.query("COMMIT");return {replayed:false,health:safe,audit};
    }catch(e){await c.query("ROLLBACK");throw e}finally{c.release()}
  }

  async credentialHealth(projectId:string){
    await this.project(projectId);const now=Date.now();
    const q=await this.pool.query(`SELECT b.binding_id AS binding_id,b.channel_id AS channel_id,b.provider AS provider,b.status AS binding_status,
      h.health_state,h.scope_state,h.channel_identity_state,h.verified_external_channel_id,h.last_verified_at,h.fresh_until
      FROM credential_bindings b LEFT JOIN credential_binding_health h ON h.binding_id=b.binding_id
      WHERE b.project_id=$1 ORDER BY b.created_at DESC`,[projectId]);
    return q.rows.map((r:any)=>({bindingId:r.binding_id,channelId:r.channel_id,provider:r.provider,bindingStatus:r.binding_status,state:r.health_state??"UNKNOWN_REQUIRES_REFRESH",scopeState:r.scope_state??"UNKNOWN",channelIdentityState:r.channel_identity_state??"UNKNOWN",verifiedExternalChannelId:r.verified_external_channel_id??null,lastVerifiedAt:r.last_verified_at??null,freshUntil:r.fresh_until??null,fresh:Boolean(r.health_state==="VALID"&&r.fresh_until&&Date.parse(r.fresh_until)>now),nextRequiredAction:r.health_state==="VALID"&&r.fresh_until&&Date.parse(r.fresh_until)>now?"NONE":"VERIFY_HEALTH"}));
  }

  async credentialDecisionItems(projectId:string){
    const health=await this.credentialHealth(projectId);
    return health.filter((h:any)=>h.bindingStatus==="ACTIVE"&&(!h.fresh||h.state!=="VALID")).map((h:any)=>({approvalId:`credential-health:${h.bindingId}`,projectId,targetType:"credential_health",targetId:h.bindingId,status:"PENDING",actionability:"ACTION_REQUIRED",actionabilityReason:h.state,evidence:{provider:h.provider,channelId:h.channelId,state:h.state,scopeState:h.scopeState,channelIdentityState:h.channelIdentityState,lastVerifiedAt:h.lastVerifiedAt},business:{title:"Verify credential health",approveEffect:"Run a bounded credential health check using the opaque binding.",notEffects:["Does not upload or publish.","Does not expose credential secrets."],impact:"LOW",allowedActions:["VERIFY_HEALTH","REFRESH_AND_VERIFY"]}}));
  }

  async operationMatrix() {
    return {
      normal: PROGRAM_05_NORMAL_OPERATIONS.map((ownerOperation) => ({ ownerOperation, uiAvailable: true, apiAvailable: true, scriptRequired: false, directDbRequired: false, breakGlassOnly:false })),
      breakGlass: PROGRAM_05_BREAK_GLASS_OPERATIONS.map((ownerOperation) => ({ ownerOperation, classification: "BREAK_GLASS_ONLY", uiAvailable: false, apiAvailable: false, explicitEngineeringGuard: true, auditRequired: true, ownerAdminRequired: true })),
    };
  }
}
