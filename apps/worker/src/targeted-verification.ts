import type pg from "pg";
import type { CollaborationArtifact, Json } from "@ai-media-factory/shared";
import type { CapabilityRequest, CapabilityResult } from "@ai-media-factory/runtime";
import {
  ArtifactIntegrityRepairStore,
  ProductionCallBudgetStore,
  ProductionModelRoutingStore,
  artifactPayloadHash,
  retrievalPreflight,
  type PostgresPersistence,
  type TargetedReevaluationRecoveryRecord,
  type TargetedVerificationDispatchRecord,
} from "@ai-media-factory/database";
import type { ProviderCapabilityBoundary } from "@ai-media-factory/provider-adapters";
import {
  TARGETED_VERIFICATION_MODE,
  buildTargetedVerificationPlan,
  validateTargetedReevaluation,
  type TargetedVerificationPlanEntry,
} from "@ai-media-factory/research-agent";
import type { ExecutionResponse } from "@ai-media-factory/runtime";
import { executeGovernedVisibleJson, groundResearchReport } from "./production-executor.js";

type RecordLike = Record<string, unknown>;
const record = (value: unknown): RecordLike => value !== null && typeof value === "object" && !Array.isArray(value) ? value as RecordLike : {};
/**
 * Bound budget-phase resolution for targeted-verification reservations.
 * The workflow submission's commandContext is the single source of truth:
 * workflows bound to an explicit Owner-authorized phase (e.g. the Golden
 * Canary envelope) reserve under that phase so recovery/replay retains it.
 * Submissions without a bound phase keep the exact legacy behavior
 * (PRE_MEDIA_PHASE).
 */
async function boundBudgetPhase(pool: pg.Pool, workflowId: string): Promise<string> {
  try {
    const q = await pool.query(`SELECT command_context FROM workflow_submissions WHERE workflow_id=$1`, [workflowId]);
    const raw: unknown = q.rows[0]?.command_context;
    const ctx: RecordLike = typeof raw === "string" ? record(JSON.parse(raw)) : record(raw);
    const phase = ctx.budgetPhase;
    if (typeof phase === "string" && phase.trim()) return phase.trim();
  } catch { /* legacy fallback below */ }
  return "PRE_MEDIA_PHASE";
}
const canonicalUrl = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  try { const url = new URL(value); url.hash = ""; url.hostname = url.hostname.toLowerCase(); if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, ""); return url.toString(); } catch { return null; }
};

export interface TargetedVerificationExecutionResult {
  readonly dispatchId: string;
  readonly revisionId: string;
  readonly retrievalCalls: number;
  readonly textCalls: number;
  readonly directionCalls: 0;
  readonly discoveryCalls: 0;
  readonly ceoCalls: 0;
  readonly output: RecordLike;
}

export interface CanonicalReevaluationRoute extends Record<string,string> {
  readonly provider: "openrouter";
  readonly model: string;
  readonly routingVersionId: string;
  readonly priceSnapshotId: string;
  readonly source: "CANONICAL_PRODUCTION_ROUTING";
  readonly routingScope: "PROJECT";
  readonly availabilityState: "CATALOG_AVAILABLE";
  readonly liveHealthState: "UNKNOWN_LIVE_HEALTH";
  readonly configurationFingerprint: string;
}

export interface TargetedVerificationRuntimeDeps {
  loadArtifact(artifactId: string): Promise<CollaborationArtifact | null>;
  executeCapability(request: CapabilityRequest): Promise<CapabilityResult>;
  resolveReevaluationRoute(projectId: string, prompt: string): Promise<CanonicalReevaluationRoute>;
  executeReevaluation(input: { dispatch: TargetedVerificationDispatchRecord; route: CanonicalReevaluationRoute; prompt: string; onTransportEvent: (state: string, metadata: Record<string, unknown>) => Promise<void> }): Promise<ExecutionResponse>;
  reserve(input: { dispatch: TargetedVerificationDispatchRecord; callKind: "research" | "text_agent"; idempotencyKey: string; callLeg: string; route?: CanonicalReevaluationRoute }): Promise<{ reservationId: string }>;
  reconcile(input: { reservationId: string; transportStarted: boolean; success: boolean; calculableCostUsd?: number }): Promise<void>;
  persistCapability(input: { dispatch: TargetedVerificationDispatchRecord; result: CapabilityResult; idempotencyKey: string }): Promise<void>;
  reviseArtifact(input: { dispatch: TargetedVerificationDispatchRecord; priorPayload: RecordLike; repairedPayload: RecordLike }): Promise<{ revisionId: string }>;
}

function reevaluationPrompt(artifact: RecordLike, plan: readonly TargetedVerificationPlanEntry[], results: readonly CapabilityResult[]): string {
  const candidates = Array.isArray(artifact.candidateStories)
    ? artifact.candidateStories.filter((item) => plan.some((entry) => entry.candidateId === record(item).candidateId)) : [];
  return `Research Agent execution mode TARGETED_VERIFICATION. Re-evaluate ONLY the supplied existing candidates under amf-evidence-sufficiency-v1.
Do not create candidates, change topic/factualAngle/keyClaims, run Direction, or perform broad synthesis.
Return JSON {"candidateUpdates":[{"candidateId":string,"factualVerification":{"status":"STRONG"|"PARTIAL"|"INCOMPLETE","basis":string},"recommendedForProduction":boolean,"supportingSourceUrls":string[],"evidenceRisks":string[]}]}.
Candidate may be recommended only when factualVerification.status is STRONG and the supplied evidence supports its existing material claims.
EXISTING_CANDIDATES=${JSON.stringify(candidates)}
TARGETED_PLAN=${JSON.stringify(plan)}
TARGETED_RESULTS=${JSON.stringify(results)}`;
}

function applyReevaluation(
  prior: RecordLike,
  plan: readonly TargetedVerificationPlanEntry[],
  results: readonly CapabilityResult[],
  reevaluation: Json,
): RecordLike {
  const updates = validateTargetedReevaluation(reevaluation, prior, plan.map((entry) => entry.candidateId));
  const executionByCandidate = new Map<string, RecordLike>();
  plan.forEach((entry, index) => executionByCandidate.set(entry.candidateId, record(results[index])));
  const sources = (Array.isArray(prior.sources) ? prior.sources : []).map((item) => ({ ...record(item) }));
  const sourceIdByUrl = new Map<string, number>();
  for (const source of sources) { const url = canonicalUrl(source.url); if (url !== null && typeof source.id === "number") sourceIdByUrl.set(url, source.id); }
  const citations = (Array.isArray(prior.citations) ? prior.citations : []).map((item) => ({ ...record(item) }));
  const candidates = (Array.isArray(prior.candidateStories) ? prior.candidateStories : []).map((item) => ({ ...record(item) }));
  for (const update of updates) {
    const execution = executionByCandidate.get(update.candidateId) ?? {};
    const rows = Array.isArray(record(execution.output).results) ? record(execution.output).results as unknown[] : [];
    const allowed = new Map(rows.map((row) => [canonicalUrl(record(row).url), record(row)]).filter((entry): entry is [string, RecordLike] => entry[0] !== null));
    const selectedSourceIds: number[] = [];
    for (const requested of update.supportingSourceUrls) {
      const url = canonicalUrl(requested);
      if (url === null || !allowed.has(url)) throw new Error(`TARGETED_REEVALUATION_SOURCE_NOT_IN_CANDIDATE_RESULT:${update.candidateId}`);
      let sourceId = sourceIdByUrl.get(url);
      if (sourceId === undefined) {
        sourceId = sources.reduce((max, source) => Math.max(max, typeof source.id === "number" ? source.id : 0), 0) + 1;
        const row = allowed.get(url)!;
        sources.push({ id: sourceId, title: String(row.title ?? ""), url: String(row.url ?? ""), snippet: String(row.snippet ?? "") });
        sourceIdByUrl.set(url, sourceId);
        citations.push({ sourceId, text: String(row.snippet ?? "").slice(0, 240) });
      }
      selectedSourceIds.push(sourceId);
    }
    const index = candidates.findIndex((candidate) => candidate.candidateId === update.candidateId);
    if (index < 0) throw new Error(`TARGETED_REEVALUATION_UNKNOWN_CANDIDATE:${update.candidateId}`);
    const current = candidates[index];
    candidates[index] = {
      ...current,
      sourceIds: [...new Set([...(Array.isArray(current.sourceIds) ? current.sourceIds.filter((id): id is number => typeof id === "number") : []), ...selectedSourceIds])],
      factualVerification: update.factualVerification,
      factualEligibility: update.factualVerification.status,
      verificationStatus: `${update.factualVerification.status}: ${update.factualVerification.basis}`,
      recommendedForProduction: update.recommendedForProduction,
      evidenceRisks: update.evidenceRisks,
    };
  }
  const capabilityExecutions = [...(Array.isArray(prior.capabilityExecutions) ? prior.capabilityExecutions : []), ...results as unknown as Json[]];
  const grounded = record(groundResearchReport({ ...prior, sources, citations, candidateStories: candidates, capabilityExecutions,
    targetedVerification: { mode: TARGETED_VERIFICATION_MODE, selectedCandidateIds: plan.map((entry) => entry.candidateId), reevaluatedAt: new Date().toISOString() } } as unknown as Json));
  const eligible = new Set(Array.isArray(grounded.ceoEligibleCandidates)
    ? grounded.ceoEligibleCandidates.filter((id): id is string => typeof id === "string") : []);
  return {
    ...grounded,
    candidateStories: (Array.isArray(grounded.candidateStories) ? grounded.candidateStories : []).map((item) => {
      const candidate = record(item);
      return { ...candidate, ceoEligible: eligible.has(String(candidate.candidateId ?? "")) };
    }),
  };
}

/** Exactly 1 candidate-specific retrieval per selected candidate + one reevaluation. */
export async function executeTargetedVerification(
  dispatch: TargetedVerificationDispatchRecord,
  deps: TargetedVerificationRuntimeDeps,
): Promise<TargetedVerificationExecutionResult> {
  if (dispatch.maxVerificationRetrievalCalls < dispatch.selectedCandidateIds.length) throw new Error("TARGETED_VERIFICATION_RETRIEVAL_ENVELOPE_TOO_SMALL");
  if (dispatch.maxReevaluationTextCalls !== 1) throw new Error("TARGETED_VERIFICATION_ONE_TEXT_CALL_REQUIRED");
  const artifact = await deps.loadArtifact(dispatch.artifactId);
  if (!artifact || artifact.workflowId !== dispatch.workflowId || artifact.producerAgent !== "research" || artifact.status !== "completed") throw new Error("TARGETED_VERIFICATION_ARTIFACT_RUNTIME_MISMATCH");
  const prior = record(artifact.payload);
  const plan = buildTargetedVerificationPlan(prior, {
    mode: TARGETED_VERIFICATION_MODE, projectId: dispatch.projectId, workflowId: dispatch.workflowId,
    artifactId: dispatch.artifactId, selectedCandidateIds: dispatch.selectedCandidateIds,
    verificationObjectives: dispatch.verificationObjectives,
    maxVerificationRetrievalCalls: dispatch.maxVerificationRetrievalCalls,
    maxReevaluationTextCalls: dispatch.maxReevaluationTextCalls,
  });
  const results: CapabilityResult[] = [];
  for (const entry of plan) {
    const idempotencyKey = `${dispatch.idempotencyKey}:targeted-verification:${entry.candidateId}:retrieval`;
    const localPreflight = retrievalPreflight({
      capabilityId: "web.search", registeredCapabilityIds: ["web.search"],
      lane: "targeted-verification", supportedLanes: ["targeted-verification"], provider: "web-search",
      query: entry.query, maxQueryLength: 200, semanticPackingCompleted: true,
      mandatorySemanticsPreserved: entry.query.trim().length > 0,
      reservationIdentity: idempotencyKey, callLeg: "TARGETED_VERIFICATION_RETRIEVAL",
    });
    if (!localPreflight.ok) throw new Error(`RETRIEVAL_PREFLIGHT_FAILED:${localPreflight.code}`);
    const reservation = await deps.reserve({ dispatch, callKind: "research", idempotencyKey, callLeg: "TARGETED_VERIFICATION_RETRIEVAL" });
    let transportStarted = false;
    let reconciled = false;
    try {
      const request = {
        requestId: `${dispatch.dispatchId}:verification-${entry.candidateId}-q1`, capabilityId: "web.search",
        agentId: "research", workflowId: dispatch.workflowId, correlationId: dispatch.dispatchId,
        requestedAt: new Date().toISOString(),
        input: { query: entry.query, maxResults: 5, laneId: "targeted-verification", candidateId: entry.candidateId },
        onExternalProviderInvocationStarted: async () => { transportStarted = true; },
      } as unknown as CapabilityRequest;
      const result = await deps.executeCapability(request);
      const success = record(result).status === "success";
      await deps.reconcile({ reservationId: reservation.reservationId, transportStarted, success });
      reconciled = true;
      if (!success) throw new Error(`TARGETED_VERIFICATION_CAPABILITY_FAILED:${entry.candidateId}`);
      await deps.persistCapability({ dispatch, result, idempotencyKey });
      results.push(result);
    } catch (error) {
      if (!reconciled) await deps.reconcile({ reservationId: reservation.reservationId, transportStarted, success: false });
      throw error;
    }
  }
  // Resolve and validate the canonical production route before acquiring the
  // text reservation. Catalog/price failure is therefore pre-transport and
  // non-consuming.
  const reevaluation = reevaluationPrompt(prior, plan, results);
  const route = await deps.resolveReevaluationRoute(dispatch.projectId, reevaluation);
  const textKey = `${dispatch.idempotencyKey}:targeted-verification:reevaluation`;
  const textReservation = await deps.reserve({ dispatch, callKind: "text_agent", idempotencyKey: textKey, callLeg: "TARGETED_VERIFICATION_REEVALUATION", route });
  let textTransportStarted = false;
  let response: ExecutionResponse;
  try {
    response = await deps.executeReevaluation({
      dispatch, route, prompt: reevaluation,
      onTransportEvent: async (state) => { if (state === "FETCH_INVOCATION_STARTED") textTransportStarted = true; },
    });
    await deps.reconcile({ reservationId: textReservation.reservationId, transportStarted: textTransportStarted, success: true, calculableCostUsd: response.usage.costUsd });
  } catch (error) {
    await deps.reconcile({ reservationId: textReservation.reservationId, transportStarted: textTransportStarted, success: false });
    throw error;
  }
  const repairedPayload = applyReevaluation(prior, plan, results, response.output);
  const revision = await deps.reviseArtifact({ dispatch, priorPayload: prior, repairedPayload });
  return { dispatchId: dispatch.dispatchId, revisionId: revision.revisionId, retrievalCalls: results.length, textCalls: 1, directionCalls: 0, discoveryCalls: 0, ceoCalls: 0, output: repairedPayload };
}

export interface TargetedReevaluationRecoveryExecutionResult {
  readonly recoveryId:string;
  readonly revisionId:string;
  readonly retrievalCalls:0;
  readonly retrievalsReused:number;
  readonly textCalls:1;
  readonly route:CanonicalReevaluationRoute;
  readonly output:RecordLike;
}

export interface TargetedReevaluationRecoveryRuntimeDeps {
  loadArtifact(artifactId:string):Promise<CollaborationArtifact|null>;
  loadPersistedResults(input:{sourceDispatchId:string;workflowId:string;candidateIds:readonly string[]}):Promise<CapabilityResult[]>;
  resolveReevaluationRoute(projectId:string,prompt:string):Promise<CanonicalReevaluationRoute>;
  reserveText(input:{recovery:TargetedReevaluationRecoveryRecord;idempotencyKey:string;route:CanonicalReevaluationRoute}):Promise<{reservationId:string}>;
  reconcile(input:{reservationId:string;transportStarted:boolean;success:boolean;calculableCostUsd?:number}):Promise<void>;
  executeReevaluation(input:{recovery:TargetedReevaluationRecoveryRecord;route:CanonicalReevaluationRoute;prompt:string;onTransportEvent:(state:string,metadata:Record<string,unknown>)=>Promise<void>}):Promise<ExecutionResponse>;
  reviseArtifact(input:{recovery:TargetedReevaluationRecoveryRecord;priorPayload:RecordLike;repairedPayload:RecordLike}):Promise<{revisionId:string}>;
}

/** Retrieval-free recovery: persisted candidate evidence -> one reevaluation -> one revision. */
export async function executeTargetedReevaluationRecovery(
  recovery:TargetedReevaluationRecoveryRecord,
  deps:TargetedReevaluationRecoveryRuntimeDeps,
):Promise<TargetedReevaluationRecoveryExecutionResult>{
  if(recovery.maxReevaluationTextCalls!==1)throw new Error("TARGETED_REEVALUATION_RECOVERY_ONE_TEXT_CALL_REQUIRED");
  const artifact=await deps.loadArtifact(recovery.artifactId);
  if(!artifact||artifact.workflowId!==recovery.workflowId||artifact.producerAgent!=="research"||artifact.status!=="completed")throw new Error("TARGETED_REEVALUATION_RECOVERY_ARTIFACT_MISMATCH");
  const prior=record(artifact.payload);
  const plan=buildTargetedVerificationPlan(prior,{mode:TARGETED_VERIFICATION_MODE,projectId:recovery.projectId,workflowId:recovery.workflowId,artifactId:recovery.artifactId,selectedCandidateIds:recovery.selectedCandidateIds,maxVerificationRetrievalCalls:recovery.selectedCandidateIds.length,maxReevaluationTextCalls:1});
  const results=await deps.loadPersistedResults({sourceDispatchId:recovery.sourceDispatchId,workflowId:recovery.workflowId,candidateIds:recovery.selectedCandidateIds});
  if(results.length!==plan.length)throw new Error("TARGETED_REEVALUATION_RECOVERY_RESULT_COUNT_MISMATCH");
  plan.forEach((entry,index)=>{
    const result=record(results[index]);const evidence=record(result.evidence);
    const expectedResult=`web-search-result-${recovery.sourceDispatchId}:verification-${entry.candidateId}-q1`;
    if(result.status!=="success"||result.capabilityId!=="web.search"||result.resultId!==expectedResult||evidence.evidenceId!==`evidence-${expectedResult}`||evidence.workflowId!==recovery.workflowId||evidence.correlationId!==recovery.sourceDispatchId||evidence.succeeded!==true)throw new Error(`TARGETED_REEVALUATION_RECOVERY_EVIDENCE_INTEGRITY_FAILED:${entry.candidateId}`);
  });
  // Availability + immutable price snapshot validation happens before the
  // only new reservation, so an unavailable route consumes nothing.
  const reevaluation=reevaluationPrompt(prior,plan,results);
  const route=await deps.resolveReevaluationRoute(recovery.projectId,reevaluation);
  const idempotencyKey=`${recovery.authorizationKey}:targeted-verification:reevaluation-recovery`;
  const reservation=await deps.reserveText({recovery,idempotencyKey,route});
  let transportStarted=false;let response:ExecutionResponse;
  try{
    response=await deps.executeReevaluation({recovery,route,prompt:reevaluation,onTransportEvent:async(state)=>{if(state==="FETCH_INVOCATION_STARTED")transportStarted=true;}});
    await deps.reconcile({reservationId:reservation.reservationId,transportStarted,success:true,calculableCostUsd:response.usage.costUsd});
  }catch(error){await deps.reconcile({reservationId:reservation.reservationId,transportStarted,success:false});throw error;}
  const repairedPayload={...applyReevaluation(prior,plan,results,response.output),targetedVerificationRecovery:{mode:"TARGETED_VERIFICATION_REEVALUATION_RECOVERY",recoveryId:recovery.recoveryId,sourceDispatchId:recovery.sourceDispatchId,reusedEvidenceIds:results.map((item)=>record(record(item).evidence).evidenceId),newRetrievals:0,route}};
  const revision=await deps.reviseArtifact({recovery,priorPayload:prior,repairedPayload});
  return{recoveryId:recovery.recoveryId,revisionId:revision.revisionId,retrievalCalls:0,retrievalsReused:results.length,textCalls:1,route,output:repairedPayload};
}

export function createProductionTargetedVerificationRuntime(input: {
  pool: pg.Pool; persistence: PostgresPersistence; providerBoundary: ProviderCapabilityBoundary;
}): TargetedVerificationRuntimeDeps {
  const budgets = new ProductionCallBudgetStore(input.pool);
  const repairs = new ArtifactIntegrityRepairStore(input.pool);
  const routing = new ProductionModelRoutingStore(input.pool);
  return {
    loadArtifact: (artifactId) => input.persistence.getArtifactById(artifactId),
    executeCapability: (request) => input.providerBoundary.boundary.executeCapability(request),
    resolveReevaluationRoute: async (projectId,prompt) => {
      const checked = await routing.preflight("research", { projectId, slot: "primary", requirements:{executionType:"HYBRID",prompt,expectedOutputTokens:1800,structuredOutput:"JSON_MODE",executionEnvironmentAllowed:true} });
      const resolved=checked.provenance;
      return { provider:"openrouter",model:resolved.model,routingVersionId:resolved.routingVersionId,priceSnapshotId:resolved.priceSnapshotId,source:"CANONICAL_PRODUCTION_ROUTING",routingScope:"PROJECT",availabilityState:"CATALOG_AVAILABLE",liveHealthState:checked.liveHealthState,configurationFingerprint:checked.configurationFingerprint };
    },
    executeReevaluation: async ({ dispatch, route, prompt, onTransportEvent }) => {
      return executeGovernedVisibleJson({ agentId: "research", workflowId: dispatch.workflowId, correlationId: dispatch.dispatchId,
        provider: route.provider, model: route.model, system: "You are the Research Agent in TARGETED_VERIFICATION mode. Return only the required JSON.",
        prompt, maxOutputTokens: 1800, onTransportEvent });
    },
    reserve: async ({ dispatch, callKind, idempotencyKey, callLeg, route }) => budgets.reserve({
      projectId: dispatch.projectId, workflowId: dispatch.workflowId, phase: await boundBudgetPhase(input.pool, dispatch.workflowId), stage: "research-targeted-verification",
      role: "research", callKind, callLeg, idempotencyKey,
      routingVersionId:route?.routingVersionId??null,exactModelId:route?.model??null,priceSnapshotId:route?.priceSnapshotId??null,
      provenance: { dispatchId: dispatch.dispatchId, callLeg, executionMode: TARGETED_VERIFICATION_MODE, ...(route?{route}: {}) },
    }),
    reconcile: (value) => budgets.reconcile({ reservationId: value.reservationId, providerSubmissionStarted: value.transportStarted, success: value.success, calculableCostUsd: value.calculableCostUsd,
      provenance: { executionMode: TARGETED_VERIFICATION_MODE } }),
    persistCapability: async ({ dispatch, result, idempotencyKey }) => {
      const value = record(result); const evidence = record(value.evidence); const evidenceId = typeof evidence.evidenceId === "string" ? evidence.evidenceId : null;
      await input.persistence.saveCapabilityExecution({ resultId: String(value.resultId), workflowId: dispatch.workflowId, correlationId: dispatch.dispatchId,
        capabilityId: "web.search", agentId: "research", status: value.status === "success" ? "success" : "failed", evidenceId,
        idempotencyKey, executedAt: typeof evidence.executedAt === "string" ? evidence.executedAt : new Date().toISOString(), payload: value });
      if (evidenceId) await input.persistence.saveExecutionEvidence({ evidenceId, workflowId: dispatch.workflowId, correlationId: dispatch.dispatchId,
        capabilityId: "web.search", agentId: "research", executedAt: typeof evidence.executedAt === "string" ? evidence.executedAt : new Date().toISOString(),
        succeeded: value.status === "success", idempotencyKey, payload: evidence });
    },
    reviseArtifact: async ({ dispatch, priorPayload, repairedPayload }) => {
      const revisionId = `targeted-verification-revision-${dispatch.dispatchId}`;
      await repairs.repairResearchArtifact({ repairId: revisionId, artifactId: dispatch.artifactId, workflowId: dispatch.workflowId,
        recoveryExecutionId: dispatch.dispatchId, repairKind: `TARGETED_VERIFICATION_REVISION:${dispatch.dispatchId}`,
        authorizationRef: dispatch.idempotencyKey, evidenceRef: `${dispatch.dispatchId}:targeted-verification`,
        expectedPriorPayloadHash: artifactPayloadHash(priorPayload), repairedPayload });
      return { revisionId };
    },
  };
}

export function createProductionTargetedReevaluationRecoveryRuntime(input:{pool:pg.Pool;persistence:PostgresPersistence}):TargetedReevaluationRecoveryRuntimeDeps{
  const budgets=new ProductionCallBudgetStore(input.pool),repairs=new ArtifactIntegrityRepairStore(input.pool),routing=new ProductionModelRoutingStore(input.pool);
  return{
    loadArtifact:(artifactId)=>input.persistence.getArtifactById(artifactId),
    loadPersistedResults:async({sourceDispatchId,workflowId,candidateIds})=>{
      const values:CapabilityResult[]=[];
      for(const candidateId of candidateIds){const resultId=`web-search-result-${sourceDispatchId}:verification-${candidateId}-q1`;const q=await input.pool.query(`SELECT c.payload,e.payload AS persisted_evidence FROM capability_executions c JOIN execution_evidence e ON e.evidence_id=c.evidence_id WHERE c.result_id=$1 AND c.workflow_id=$2 AND c.correlation_id=$3 AND c.status='success' AND c.capability_id='web.search' AND e.workflow_id=$2 AND e.correlation_id=$3 AND e.succeeded=TRUE`,[resultId,workflowId,sourceDispatchId]);if(!q.rowCount)throw new Error(`TARGETED_REEVALUATION_RECOVERY_EVIDENCE_MISSING:${candidateId}`);const value=record(q.rows[0].payload);const evidence=record(value.evidence);if(JSON.stringify(evidence)!==JSON.stringify(record(q.rows[0].persisted_evidence)))throw new Error(`TARGETED_REEVALUATION_RECOVERY_EVIDENCE_PAYLOAD_MISMATCH:${candidateId}`);values.push(value as unknown as CapabilityResult);}return values;
    },
    resolveReevaluationRoute:async(projectId,prompt)=>{const checked=await routing.preflight("research",{projectId,slot:"primary",requirements:{executionType:"HYBRID",prompt,expectedOutputTokens:1800,structuredOutput:"JSON_MODE",executionEnvironmentAllowed:true}});const r=checked.provenance;return{provider:"openrouter",model:r.model,routingVersionId:r.routingVersionId,priceSnapshotId:r.priceSnapshotId,source:"CANONICAL_PRODUCTION_ROUTING",routingScope:"PROJECT",availabilityState:"CATALOG_AVAILABLE",liveHealthState:checked.liveHealthState,configurationFingerprint:checked.configurationFingerprint};},
    reserveText:async({recovery,idempotencyKey,route})=>budgets.reserve({projectId:recovery.projectId,workflowId:recovery.workflowId,phase:await boundBudgetPhase(input.pool,recovery.workflowId),stage:"research-targeted-verification-reevaluation-recovery",role:"research",callKind:"text_agent",callLeg:"TARGETED_VERIFICATION_REEVALUATION_RECOVERY",idempotencyKey,routingVersionId:route.routingVersionId,exactModelId:route.model,priceSnapshotId:route.priceSnapshotId,provenance:{recoveryId:recovery.recoveryId,sourceDispatchId:recovery.sourceDispatchId,callLeg:"TARGETED_VERIFICATION_REEVALUATION_RECOVERY",executionMode:"TARGETED_VERIFICATION_REEVALUATION_RECOVERY",route}}),
    reconcile:(value)=>budgets.reconcile({reservationId:value.reservationId,providerSubmissionStarted:value.transportStarted,success:value.success,calculableCostUsd:value.calculableCostUsd,provenance:{executionMode:"TARGETED_VERIFICATION_REEVALUATION_RECOVERY"}}),
    executeReevaluation:({recovery,route,prompt,onTransportEvent})=>executeGovernedVisibleJson({agentId:"research",workflowId:recovery.workflowId,correlationId:recovery.recoveryId,provider:route.provider,model:route.model,system:"You are the Research Agent in TARGETED_VERIFICATION_REEVALUATION_RECOVERY mode. Return only the required JSON.",prompt,maxOutputTokens:1800,onTransportEvent}),
    reviseArtifact:async({recovery,priorPayload,repairedPayload})=>{const revisionId=`targeted-verification-revision-${recovery.sourceDispatchId}`;await repairs.repairResearchArtifact({repairId:revisionId,artifactId:recovery.artifactId,workflowId:recovery.workflowId,recoveryExecutionId:recovery.recoveryId,repairKind:`TARGETED_VERIFICATION_REVISION:${recovery.sourceDispatchId}`,authorizationRef:recovery.authorizationKey,evidenceRef:`${recovery.sourceDispatchId}:persisted-targeted-evidence`,expectedPriorPayloadHash:artifactPayloadHash(priorPayload),repairedPayload});return{revisionId};},
  };
}
