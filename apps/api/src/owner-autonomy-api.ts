/** Program 5 Owner Autonomy product API.
 *
 * This module exposes product workflows over canonical domain authorities.
 * It never calls a provider and never creates a parallel execution system.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OwnerAutonomyStore, NextCycleOwnerDecision, ControlPlaneStore, ChannelStore, CredentialHealthAction, SafeCredentialHealthResult } from "@ai-media-factory/database";

export interface CredentialHealthVerificationInput {
  action: CredentialHealthAction; provider: string; credentialReference: string;
  expectedExternalChannelId: string; projectId: string; bindingId: string; channelId: string;
}
export interface CredentialHealthVerifier { verify(input:CredentialHealthVerificationInput):Promise<SafeCredentialHealthResult> }

export interface OwnerAutonomyApiDeps {
  ownerAutonomy?: OwnerAutonomyStore;
  control: ControlPlaneStore;
  channels?: ChannelStore;
  credentialHealthVerifier?: CredentialHealthVerifier;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type":"application/json", "Content-Length":Buffer.byteLength(data), "Cache-Control":"no-store" });
  res.end(data);
}

function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve,reject) => {
    let raw=""; req.on("data", (part) => { raw += part; });
    req.on("end", () => { try { resolve(raw ? JSON.parse(raw) as Record<string,unknown> : {}); } catch { reject(new Error("invalid JSON body")); } });
    req.on("error", reject);
  });
}

function store(deps: OwnerAutonomyApiDeps): OwnerAutonomyStore {
  if (!deps.ownerAutonomy) throw new Error("owner autonomy store is not configured");
  return deps.ownerAutonomy;
}

export async function ownerOnboarding(deps: OwnerAutonomyApiDeps,res:ServerResponse,url:URL) {
  const projectId=url.searchParams.get("projectId"); if(!projectId)return send(res,400,{error:"projectId is required"});
  try { send(res,200,await store(deps).onboarding(projectId)); } catch(e) { send(res,errorStatus(e),{error:errorText(e)}); }
}

export async function ownerRouting(deps: OwnerAutonomyApiDeps,res:ServerResponse,url:URL) {
  const projectId=url.searchParams.get("projectId"); if(!projectId)return send(res,400,{error:"projectId is required"});
  try { send(res,200,{projectId,versions:await store(deps).routing(projectId)}); } catch(e) { send(res,errorStatus(e),{error:errorText(e)}); }
}

export async function ownerRoutingActivate(deps:OwnerAutonomyApiDeps,req:IncomingMessage,res:ServerResponse) {
  const b=await body(req); if(typeof b.projectId!=="string"||typeof b.routingVersionId!=="string"||typeof b.reason!=="string")return send(res,400,{error:"projectId, routingVersionId and reason are required"});
  try { send(res,200,await store(deps).activateRouting({projectId:b.projectId,routingVersionId:b.routingVersionId,reason:b.reason,actor:typeof b.actor==="string"?b.actor:"owner"})); } catch(e) { send(res,errorStatus(e),{error:errorText(e)}); }
}

export async function ownerBudgetSet(deps:OwnerAutonomyApiDeps,req:IncomingMessage,res:ServerResponse) {
  const b=await body(req); if(typeof b.projectId!=="string"||typeof b.phase!=="string"||typeof b.callKind!=="string"||typeof b.limit!=="number"||typeof b.reason!=="string")return send(res,400,{error:"projectId, phase, callKind, limit and reason are required"});
  try { send(res,200,await store(deps).setBudget({projectId:b.projectId,phase:b.phase,callKind:b.callKind,limit:b.limit,maxRetries:typeof b.maxRetries==="number"?b.maxRetries:0,reason:b.reason,actor:typeof b.actor==="string"?b.actor:"owner"})); } catch(e) { send(res,errorStatus(e),{error:errorText(e)}); }
}

export async function ownerNextCycleList(deps:OwnerAutonomyApiDeps,res:ServerResponse,url:URL) {
  const projectId=url.searchParams.get("projectId"); if(!projectId)return send(res,400,{error:"projectId is required"});
  try { send(res,200,{projectId,proposals:await store(deps).nextCycle(projectId)}); } catch(e) { send(res,errorStatus(e),{error:errorText(e)}); }
}

export async function ownerNextCycleDecide(deps:OwnerAutonomyApiDeps,req:IncomingMessage,res:ServerResponse,proposalId:string) {
  const b=await body(req); if(typeof b.projectId!=="string"||typeof b.decision!=="string"||typeof b.rationale!=="string")return send(res,400,{error:"projectId, decision and rationale are required"});
  try { send(res,200,await store(deps).decideNextCycle({projectId:b.projectId,proposalId,decision:b.decision as NextCycleOwnerDecision,rationale:b.rationale,actor:typeof b.actor==="string"?b.actor:"owner"})); } catch(e) { send(res,errorStatus(e),{error:errorText(e)}); }
}

export async function ownerAudit(deps:OwnerAutonomyApiDeps,res:ServerResponse,url:URL) {
  const projectId=url.searchParams.get("projectId"); if(!projectId)return send(res,400,{error:"projectId is required"});
  try { send(res,200,{projectId,events:await store(deps).auditEvents(projectId,Number(url.searchParams.get("limit")??100))}); } catch(e) { send(res,errorStatus(e),{error:errorText(e)}); }
}

export async function ownerOperationMatrix(deps:OwnerAutonomyApiDeps,res:ServerResponse) {
  send(res,200,await store(deps).operationMatrix());
}

export async function ownerCredentialHealthList(deps:OwnerAutonomyApiDeps,res:ServerResponse,url:URL){
  const projectId=url.searchParams.get("projectId");if(!projectId)return send(res,400,{error:"projectId is required"});
  try{send(res,200,{projectId,credentials:await store(deps).credentialHealth(projectId)})}catch(e){send(res,errorStatus(e),{error:errorText(e)})}
}

export async function ownerCredentialHealthVerify(deps:OwnerAutonomyApiDeps,req:IncomingMessage,res:ServerResponse,bindingId:string){
  const b=await body(req);const projectId=typeof b.projectId==="string"?b.projectId:"";const action=typeof b.action==="string"?b.action as CredentialHealthAction:"VERIFY_HEALTH";const reason=typeof b.reason==="string"?b.reason:"";const idempotencyKey=typeof b.idempotencyKey==="string"?b.idempotencyKey:"";
  if(!projectId||!reason||!idempotencyKey)return send(res,400,{error:"projectId, reason and idempotencyKey are required"});
  if(!deps.credentialHealthVerifier)return send(res,503,{error:"credential health verifier is not configured"});
  try{
    const claim=await store(deps).claimCredentialHealth({projectId,bindingId,action,idempotencyKey,actor:typeof b.actor==="string"?b.actor:"owner",reason});
    if(!claim.created){
      if(claim.status!=="COMPLETED")return send(res,409,{error:"CREDENTIAL_HEALTH_CHECK_IN_PROGRESS",checkId:claim.checkId});
      return send(res,200,{checkId:claim.checkId,replayed:true,health:claim.result});
    }
    if(!claim.target)throw new Error("CREDENTIAL_HEALTH_TARGET_MISSING");
    let result:SafeCredentialHealthResult;
    try{result=await deps.credentialHealthVerifier.verify(claim.target)}catch(error){
      const at=new Date().toISOString();result={state:"ERROR",scopeState:"UNKNOWN",channelIdentityState:"UNKNOWN",reasonCode:"PROVIDER_VERIFICATION_ERROR",evidenceFingerprint:(await import("node:crypto")).createHash("sha256").update(`${claim.checkId}:ERROR:${error instanceof Error?error.name:"UNKNOWN"}`).digest("hex"),verifiedAt:at,freshUntil:new Date(Date.parse(at)+60*60*1000).toISOString()};
    }
    const completed=await store(deps).completeCredentialHealth({checkId:claim.checkId,result});
    send(res,200,{checkId:claim.checkId,replayed:false,health:completed.health,audit:completed.audit});
  }catch(e){send(res,errorStatus(e),{error:errorText(e)})}
}

export async function ownerHealth(deps:OwnerAutonomyApiDeps,res:ServerResponse,url:URL) {
  const projectId=url.searchParams.get("projectId"); if(!projectId)return send(res,400,{error:"projectId is required"});
  try {
    const [health,onboarding,credentialHealth] = await Promise.all([deps.control.platformHealth(),store(deps).onboarding(projectId),store(deps).credentialHealth(projectId)]);
    const alerts: Array<Record<string,unknown>>=[];
    if(health.workers.stale)alerts.push({kind:"WORKER_STOPPED_OR_STALE",severity:"BLOCKING",action:"Use the governed Worker control in AMF Control; never kill arbitrary processes."});
    if(!onboarding.checks.routingActive)alerts.push({kind:"ROUTING_UNAVAILABLE",severity:"BLOCKING",action:"Activate a benchmark-backed project route."});
    for(const b of onboarding.budgets)if(b.remaining<=0)alerts.push({
      kind:"BUDGET_EXHAUSTED",severity:"BLOCKING",subject:`${b.phase}:${b.callKind}`,
      phase:b.phase,callKind:b.callKind,used:b.used,limit:b.limit,reserved:b.reserved,remaining:b.remaining,
      classification:"CURRENT_CAPACITY_EXHAUSTION",blocksCurrentOwnerJourney:false,
      action:"Capacity is exhausted for this call kind. The zero-spend Owner control journey is not blocked; separately authorize capacity only before a workflow that requires it.",
    });
    for(const c of onboarding.channels)if(c.status!=="VERIFIED")alerts.push({kind:"CHANNEL_NOT_VERIFIED",severity:"BLOCKING",subject:c.channelId,action:"Verify channel identity."});
    for(const c of credentialHealth)if(c.bindingStatus==="ACTIVE"&&(!c.fresh||c.state!=="VALID"))alerts.push({kind:"CREDENTIAL_HEALTH_REQUIRED",severity:"BLOCKING",subject:c.bindingId,state:c.state,action:"Open AMF Control → Credentials → Verify Health."});
    const providers = [{provider:"openrouter",configured:Boolean(process.env.OPENROUTER_API_KEY),catalogState:Boolean(process.env.OPENROUTER_API_KEY)?"CONFIGURED":"UNAVAILABLE",liveHealth:"UNKNOWN_LIVE_HEALTH",lastVerifiedAt:null},
      {provider:"self-hosted-video",configured:Boolean(process.env.RUNPOD_API_KEY),catalogState:Boolean(process.env.RUNPOD_API_KEY)?"CONFIGURED":"UNAVAILABLE",liveHealth:"UNKNOWN_LIVE_HEALTH",lastVerifiedAt:null,sourceHardening:"PASS",deployment:"NOT_CERTIFIED",futureGeneration:"BLOCKED"}];
    send(res,200,{projectId,worker:health.workers,queue:health.queue,recentFailures:health.recentFailures,providers,alerts,wan:{futureSubmissionsAllowed:false,sourceHardening:"PROVIDER_FREE_PASS",deploymentCertification:"NOT_CERTIFIED",blockerPreserved:true,reasons:["HARDENED_HANDLER_NOT_DEPLOYED","PERSISTENT_RECEIPT_STORAGE_NOT_CERTIFIED","ENDPOINT_DIGEST_SOURCE_PARITY_NOT_PROVEN"]}});
  } catch(e) { send(res,errorStatus(e),{error:errorText(e)}); }
}

const execFileAsync = promisify(execFile);
export async function ownerWorkerControl(deps:OwnerAutonomyApiDeps,req:IncomingMessage,res:ServerResponse) {
  const b=await body(req); const projectId=typeof b.projectId==="string"?b.projectId:"";
  const action=typeof b.action==="string"?b.action.toUpperCase():""; const reason=typeof b.reason==="string"?b.reason.trim():"";
  if(!projectId||!["START","STOP","RESTART"].includes(action)||!reason)return send(res,400,{error:"projectId, START/STOP/RESTART action and reason are required"});
  const repositoryRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../../..");
  const script=path.resolve(repositoryRoot,"scripts","persistent-worker.mjs");
  try {
    const outputs: unknown[]=[];
    const invoke=async(command:"start"|"stop")=>{const result=await execFileAsync(process.execPath,[script,command],{cwd:repositoryRoot,timeout:30000,windowsHide:true,maxBuffer:1024*1024});let parsed:unknown=result.stdout.trim();try{parsed=JSON.parse(String(parsed))}catch{}outputs.push(parsed)};
    if(action==="STOP"||action==="RESTART")await invoke("stop");
    if(action==="START"||action==="RESTART")await invoke("start");
    const audit=await store(deps).recordOwnerAction({projectId,action:`WORKER_${action}`,subjectType:"canonical_worker",subjectId:"canonical-production-queue-worker",actor:typeof b.actor==="string"?b.actor:"owner",reason,after:{launcher:"scripts/persistent-worker.mjs",outputs},metadata:{arbitraryProcessKill:false}});
    send(res,200,{action,launcher:"CANONICAL_PERSISTENT_WORKER",outputs,audit});
  } catch(e) { send(res,409,{error:`WORKER_CONTROL_FAILED:${errorText(e)}`}); }
}

function errorText(e:unknown):string{return e instanceof Error?e.message:String(e)}
function errorStatus(e:unknown):number{const t=errorText(e);return t.includes("CROSS_PROJECT")?403:t.includes("NOT_FOUND")?404:400}
