import {test,before,after} from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {createHash} from "node:crypto";
import {createPool,migrate,PostgresPersistence,PostgresQueue,ControlPlaneStore,ChannelStore,OwnerAutonomyStore,ApprovalActionabilityStore,AutomationStore} from "@ai-media-factory/database";
import {createWorkflowApiHandler} from "@ai-media-factory/api";
import {TEST_DATABASE_URL,assertTestDatabaseIsolation} from "../../../packages/database/test/helpers.js";

assertTestDatabaseIsolation();
process.env.AMF_OWNER_TOKEN="program-5-owner-test";
const auth={Authorization:"Bearer program-5-owner-test","Content-Type":"application/json"};
const suffix=`${process.pid}-${Date.now().toString(36)}`;const projectA=`p5-health-a-${suffix}`,projectB=`p5-health-b-${suffix}`;
let pool,server,base,bindingA,bindingB,calls=0,nextState="VALID";
const fp=(x)=>createHash("sha256").update(x).digest("hex");
const verifier={async verify(input){calls++;const at=new Date().toISOString();const state=nextState;return {state,scopeState:state==="VALID"?"PASS":state==="INSUFFICIENT_SCOPE"?"FAIL":"UNKNOWN",channelIdentityState:state==="VALID"?"MATCH":state==="CHANNEL_IDENTITY_MISMATCH"?"MISMATCH":"UNKNOWN",verifiedExternalChannelId:state==="VALID"?input.expectedExternalChannelId:state==="CHANNEL_IDENTITY_MISMATCH"?"UC-wrong":null,reasonCode:`FAKE_${state}`,evidenceFingerprint:fp(`${input.bindingId}:${state}`),verifiedAt:at,freshUntil:new Date(Date.now()+3600000).toISOString()}}};
const request=async(path,{method="GET",body,headers=auth}={})=>{const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json()}};
const post=(path,body,headers=auth)=>request(path,{method:"POST",body,headers});

before(async()=>{
  pool=createPool({connectionString:TEST_DATABASE_URL});await migrate(pool);
  const persistence=new PostgresPersistence(pool),control=new ControlPlaneStore(pool),channels=new ChannelStore(pool),ownerAutonomy=new OwnerAutonomyStore(pool);
  const handler=createWorkflowApiHandler({persistence,queue:new PostgresQueue(pool),control,channels,ownerAutonomy,actionability:new ApprovalActionabilityStore(pool),automation:new AutomationStore(pool),credentialHealthVerifier:verifier});
  server=createServer((req,res)=>void handler(req,res));await new Promise(r=>server.listen(0,"127.0.0.1",r));base=`http://127.0.0.1:${server.address().port}`;
  for(const projectId of [projectA,projectB])assert.ok([200,201].includes((await post("/control/projects",{projectId,displayName:projectId})).status));
  const setup=async(projectId,external)=>{const c=(await post("/control/channels",{projectId,platform:"youtube",displayName:`${projectId} channel`})).body.channel;await post(`/control/channels/${c.channelId}/verify`,{externalChannelId:external,rationale:"provider-free fixture"});return (await post(`/control/channels/${c.channelId}/bindings`,{projectId,provider:"youtube",credentialRef:`opaque-secret-ref-${projectId}`})).body.binding};
  bindingA=await setup(projectA,"UC-health-a");bindingB=await setup(projectB,"UC-health-b");
});

after(async()=>{
  await new Promise(r=>server.close(r));
  await pool.query(`DELETE FROM production_model_routing_entries WHERE routing_version_id=$1`,[`route-${suffix}`]);
  await pool.query(`DELETE FROM production_model_routing_versions WHERE routing_version_id=$1`,[`route-${suffix}`]);
  await pool.query(`DELETE FROM model_benchmark_runs WHERE benchmark_run_id=$1`,[`benchmark-${suffix}`]);
  for(const table of ["automation_policies","next_cycle_owner_decisions","next_cycle_proposals","next_cycle_recommendations","learning_records","credential_binding_health","credential_health_checks","owner_control_audit_events","control_approvals","production_phase_call_budgets","credential_bindings","channels","control_projects"])await pool.query(`DELETE FROM ${table} WHERE project_id=ANY($1)`,[[projectA,projectB]]);
  await pool.end();
});

test("intentional OFF / L0_MANUAL automation is readiness-safe without enabling automation",async()=>{
  const onboarding=await request(`/control/owner/onboarding?projectId=${projectA}`);
  assert.equal(onboarding.status,200);
  assert.equal(onboarding.body.automation.enabled,false);
  assert.equal(onboarding.body.automation.level,"L0_MANUAL");
  assert.equal(onboarding.body.checks.automationPolicy,true);
});

test("A/B/C/D/E/F/G/H: Owner verification is authenticated, scoped, idempotent, and secret-free",async()=>{
  const path=`/control/owner/credentials/${bindingA.bindingId}/verify`,payload={projectId:projectA,action:"VERIFY_HEALTH",reason:"Owner health check",idempotencyKey:"program-5-health-a"};
  assert.equal((await post(path,payload,{"Content-Type":"application/json"})).status,401);
  assert.equal((await post(path,{...payload,projectId:projectB,idempotencyKey:"wrong-project"})).status,403);
  assert.equal((await post(`/control/owner/credentials/${bindingB.bindingId}/verify`,{...payload,idempotencyKey:"foreign-binding"})).status,403);
  nextState="VALID";const first=await post(path,payload);assert.equal(first.status,200);assert.equal(first.body.health.state,"VALID");assert.equal(calls,1);
  const replay=await post(path,payload);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);assert.equal(calls,1);
  const serialized=JSON.stringify(first.body);assert.doesNotMatch(serialized,/opaque-secret-ref|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization/i);
  const audits=await request(`/control/owner/audit?projectId=${projectA}`);const event=audits.body.events.find(x=>x.action==="CREDENTIAL_VERIFY_HEALTH");assert.ok(event);assert.doesNotMatch(JSON.stringify(event),/opaque-secret-ref|access[_-]?token|refresh[_-]?token|client[_-]?secret/i);
  const decisions=await request(`/control/decision-queue?projectId=${projectA}`);assert.equal(decisions.body.needsDecision.some(x=>x.targetId===bindingA.bindingId),false);
});

test("I/J: precise failures persist safely and surface in Decision Center",async()=>{
  for(const state of ["EXPIRED","REVOKED","INSUFFICIENT_SCOPE","CHANNEL_IDENTITY_MISMATCH","ERROR"]){
    nextState=state;const result=await post(`/control/owner/credentials/${bindingA.bindingId}/verify`,{projectId:projectA,action:"REFRESH_AND_VERIFY",reason:`fixture ${state}`,idempotencyKey:`program-5-${state}`});assert.equal(result.status,200);assert.equal(result.body.health.state,state);assert.doesNotMatch(JSON.stringify(result.body),/opaque-secret-ref/i);
    const decisions=await request(`/control/decision-queue?projectId=${projectA}`);const item=decisions.body.needsDecision.find(x=>x.targetId===bindingA.bindingId);assert.ok(item);assert.equal(item.actionabilityReason,state);
  }
});

test("E2E-P5-01/P5-06 complete onboarding uses product actions and reaches ready state",async()=>{
  nextState="VALID";await post(`/control/owner/credentials/${bindingA.bindingId}/verify`,{projectId:projectA,action:"VERIFY_HEALTH",reason:"restore valid",idempotencyKey:"program-5-valid-final"});
  const now=new Date().toISOString(),benchmark=`benchmark-${suffix}`,route=`route-${suffix}`;
  // Benchmark evidence is a provider-free test fixture. The Owner configuration
  // itself is performed exclusively through the product API below.
  await pool.query(`INSERT INTO model_benchmark_runs(benchmark_run_id,dataset_version,catalog_snapshot_id,candidate_plan_version,status,created_at,authorization_state,hard_spend_cap_usd,created_by) VALUES($1,'p5-fixture','catalog-fixture','plan-fixture','COMPLETED',$2,'NOT_AUTHORIZED',0,'provider-free-test')`,[benchmark,now]);
  await pool.query(`INSERT INTO production_model_routing_versions(routing_version_id,profile,scope_type,project_id,benchmark_run_id,dataset_version,decision_source,owner_decision,active,provenance) VALUES($1,'balanced','PROJECT',$2,$3,'p5-fixture','BENCHMARK','PENDING',FALSE,'{}')`,[route,projectA,benchmark]);
  await pool.query(`INSERT INTO production_model_routing_entries(routing_version_id,role,primary_model_id,evidence) VALUES($1,'Writer','fixture-model','{"providerFree":true}')`,[route]);
  assert.equal((await post("/control/owner/routing/activate",{projectId:projectA,routingVersionId:route,reason:"Provider-free onboarding route"})).status,200);
  assert.equal((await post("/control/owner/budgets",{projectId:projectA,phase:"P5_ONBOARDING",callKind:"analytics",limit:1,maxRetries:0,reason:"Provider-free onboarding envelope"})).status,200);
  for(const [callKind,limit] of [["research",4],["text_agent",10],["image_generation",1]]){
    assert.equal((await post("/control/owner/budgets",{projectId:projectA,phase:"MORROWAY_PRODUCTION_CYCLE_01_PRE_MEDIA",callKind,limit,maxRetries:0,reason:"Provider-free Cycle-01 onboarding fixture"})).status,200);
  }
  assert.equal((await post("/control/automation/policy",{projectId:projectA,enabled:false,level:"L0_MANUAL",allowedOps:[],humanGatedOps:[],providerPolicy:{mode:"DENY_ALL"},publicationPolicy:"OWNER_APPROVAL_REQUIRED",nextCyclePolicy:"OWNER_START_ONLY"})).status,200);
  const onboarding=await request(`/control/owner/onboarding?projectId=${projectA}`);assert.equal(onboarding.status,200);assert.equal(onboarding.body.ready,true);assert.ok(Object.values(onboarding.body.checks).every(Boolean));
  assert.equal((await post("/control/owner/budgets",{projectId:projectA,phase:"P5_ALERT",callKind:"video_generation",limit:0,maxRetries:0,reason:"Provider-free alert presentation fixture"})).status,200);
  const health=await request(`/control/owner/health?projectId=${projectA}`);const alert=health.body.alerts.find(x=>x.phase==="P5_ALERT"&&x.callKind==="video_generation");assert.ok(alert);assert.equal(alert.used,0);assert.equal(alert.limit,0);assert.equal(alert.classification,"CURRENT_CAPACITY_EXHAUSTION");assert.equal(alert.blocksCurrentOwnerJourney,false);
});

test("Program-4 Owner journey replays through real control API actions and stops at next-cycle decision",async()=>{
  const actionTypes=["TTS_CONFIG","SCENE_VISUAL_ARTIFACT","VIDEO_RECOVERY","FINAL_PRODUCT","PRIVATE_PUBLICATION"];
  for(const targetType of actionTypes){
    const created=await post("/control/approvals",{projectId:projectA,targetType,targetId:`${targetType.toLowerCase()}-${suffix}`,agentRecommendation:{providerFreeStub:true}});assert.equal(created.status,201);
    const decided=await post(`/control/approvals/${created.body.approval.approvalId}/decision`,{action:"APPROVE",rationale:`provider-free ${targetType} Owner action`});assert.equal(decided.status,200);assert.equal(decided.body.approval.status,"DECIDED");
  }
  const now=new Date().toISOString(),learning=`learn-journey-${suffix}`,recommendation=`rec-journey-${suffix}`,proposal=`ncp-journey-${suffix}`;
  await pool.query(`INSERT INTO learning_records(learning_id,project_id,source_observation_ids,finding,evidence,validation_only,created_at) VALUES($1,$2,'[]','provider-free process evidence','{}',1,$3)`,[learning,projectA,now]);
  await pool.query(`INSERT INTO next_cycle_recommendations(recommendation_id,project_id,learning_id,proposal,rationale,evidence,requires_owner_decision,created_at) VALUES($1,$2,$3,'future bounded cycle','provider-free evidence','{}',1,$4)`,[recommendation,projectA,learning,now]);
  await pool.query(`INSERT INTO next_cycle_proposals(proposal_id,project_id,recommendation_id,summary,status,created_at) VALUES($1,$2,$3,'Owner decision only','AWAITS_OWNER_DECISION',$4)`,[proposal,projectA,recommendation,now]);
  const decision=await post(`/control/owner/next-cycle/${proposal}/decision`,{projectId:projectA,decision:"DEFER",rationale:"No next cycle during certification"});assert.equal(decision.status,200);assert.equal(decision.body.workflowCreated,false);assert.equal(decision.body.nextCycleState,"OWNER_DEFERRED");
  const queue=await request(`/control/decision-queue?projectId=${projectA}`);assert.equal(queue.status,200);assert.ok(!queue.body.needsDecision.some(x=>actionTypes.includes(x.targetType)));
  const matrix=await request("/control/owner/operation-matrix");assert.ok(matrix.body.normal.every(x=>x.uiAvailable&&x.apiAvailable&&!x.scriptRequired&&!x.directDbRequired));
});
