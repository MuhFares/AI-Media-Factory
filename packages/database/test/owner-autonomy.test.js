import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, ControlPlaneStore, OwnerAutonomyStore, ChannelStore } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();
let pool, owner, control, a, b, binding;
before(async()=>{
  pool=createPool({connectionString:TEST_DATABASE_URL});await migrate(pool);
  owner=new OwnerAutonomyStore(pool);control=new ControlPlaneStore(pool);
  const nonce=`${Date.now().toString(36)}${Math.random().toString(36).slice(2,7)}`;a=`p5-a-${nonce}`;b=`p5-b-${nonce}`;
  await control.registerProject({projectId:a,displayName:"Program 5 A",createdBy:"test"});
  await control.registerProject({projectId:b,displayName:"Program 5 B",createdBy:"test"});
  const channels=new ChannelStore(pool);const channel=await channels.createChannel({projectId:a,platform:"youtube",displayName:"A"});
  await channels.verifyChannel({channelId:channel.channelId,externalChannelId:"UC-program-5-a",rationale:"provider-free fixture"});
  binding=await channels.bindCredential({projectId:a,channelId:channel.channelId,provider:"youtube",credentialRef:"opaque-test-reference"});
});
after(async()=>{
  await pool.query(`DELETE FROM credential_binding_health WHERE project_id=ANY($1)`,[[a,b]]);
  await pool.query(`DELETE FROM credential_health_checks WHERE project_id=ANY($1)`,[[a,b]]);
  await pool.query(`DELETE FROM next_cycle_owner_decisions WHERE project_id=ANY($1)`,[[a,b]]);
  await pool.query(`DELETE FROM next_cycle_proposals WHERE project_id=ANY($1)`,[[a,b]]);
  await pool.query(`DELETE FROM next_cycle_recommendations WHERE project_id=ANY($1)`,[[a,b]]);
  await pool.query(`DELETE FROM learning_records WHERE project_id=ANY($1)`,[[a,b]]);
  await pool.query(`DELETE FROM owner_control_audit_events WHERE project_id=ANY($1)`,[[a,b]]);
  await pool.query(`DELETE FROM production_phase_call_budgets WHERE project_id=ANY($1)`,[[a,b]]);
  await pool.query(`DELETE FROM credential_bindings WHERE project_id=ANY($1)`,[[a,b]]);
  await pool.query(`DELETE FROM channels WHERE project_id=ANY($1)`,[[a,b]]);
  await pool.query(`DELETE FROM control_projects WHERE project_id=ANY($1)`,[[a,b]]);
  await pool.end();
});

test("new branded project onboarding fails closed without route/budget/credential health",async()=>{
  const x=await owner.onboarding(a);assert.equal(x.ready,false);assert.equal(x.checks.routingActive,false);assert.equal(x.checks.credentialBinding,true);assert.equal(x.checks.credentialHealth,false);assert.ok(x.failClosedReasons.includes("routingActive"));
});

test("bounded budget change is audited and never grants execution authority",async()=>{
  const r=await owner.setBudget({projectId:a,phase:"P5_FIXTURE",callKind:"analytics",limit:1,maxRetries:0,actor:"owner-test",reason:"one provider-free fixture slot"});
  assert.deepEqual({limit:r.budget.limit,remaining:r.budget.remaining,maxRetries:r.budget.maxRetries},{limit:1,remaining:1,maxRetries:0});
  const events=await owner.auditEvents(a);const e=events.find(x=>x.eventId===r.audit.eventId);assert.equal(e.metadata.executionAuthorityGranted,false);
  await pool.query(`UPDATE production_phase_call_budgets SET consumed_count=1 WHERE project_id=$1 AND phase='P5_FIXTURE' AND call_kind='analytics'`,[a]);
  await assert.rejects(owner.setBudget({projectId:a,phase:"P5_FIXTURE",callKind:"analytics",limit:0,maxRetries:0,actor:"owner-test",reason:"invalid reduction"}),/BELOW_CURRENT_EXPOSURE/);
});

test("next-cycle decisions are project-scoped immutable and start no workflow",async()=>{
  const now=new Date().toISOString(),learning=`learn-${a}`,rec=`rec-${a}`,proposal=`ncp-${a}`;
  await pool.query(`INSERT INTO learning_records(learning_id,project_id,source_observation_ids,finding,evidence,validation_only,created_at) VALUES($1,$2,'[]','process only','{}',1,$3)`,[learning,a,now]);
  await pool.query(`INSERT INTO next_cycle_recommendations(recommendation_id,project_id,learning_id,proposal,rationale,evidence,requires_owner_decision,created_at) VALUES($1,$2,$3,'future measurement','evidence bound','{}',1,$4)`,[rec,a,learning,now]);
  await pool.query(`INSERT INTO next_cycle_proposals(proposal_id,project_id,recommendation_id,summary,status,created_at) VALUES($1,$2,$3,'Owner decision required','AWAITS_OWNER_DECISION',$4)`,[proposal,a,rec,now]);
  await assert.rejects(owner.decideNextCycle({projectId:b,proposalId:proposal,decision:"DEFER",rationale:"other project",actor:"owner-test"}),/CROSS_PROJECT_DENIED/);
  const result=await owner.decideNextCycle({projectId:a,proposalId:proposal,decision:"DEFER",rationale:"wait for meaningful window",actor:"owner-test"});
  assert.equal(result.workflowCreated,false);assert.equal(result.nextCycleState,"OWNER_DEFERRED");
  await assert.rejects(owner.decideNextCycle({projectId:a,proposalId:proposal,decision:"APPROVE",rationale:"changed mind",actor:"owner-test"}),/IMMUTABLE/);
});

test("credential health is idempotent, project-scoped, safe, fresh, and resolves Decision Center attention",async()=>{
  const before=await owner.credentialDecisionItems(a);assert.ok(before.some(x=>x.targetId===binding.bindingId));
  await assert.rejects(owner.claimCredentialHealth({projectId:b,bindingId:binding.bindingId,action:"VERIFY_HEALTH",idempotencyKey:"cross-project",actor:"owner",reason:"deny"}),/CROSS_PROJECT_DENIED/);
  const claim=await owner.claimCredentialHealth({projectId:a,bindingId:binding.bindingId,action:"VERIFY_HEALTH",idempotencyKey:"health-1",actor:"owner",reason:"verify"});assert.equal(claim.created,true);assert.equal(claim.target.credentialReference,"opaque-test-reference");
  const at=new Date().toISOString();const done=await owner.completeCredentialHealth({checkId:claim.checkId,result:{state:"VALID",scopeState:"PASS",channelIdentityState:"MATCH",verifiedExternalChannelId:"UC-program-5-a",reasonCode:"VERIFIED",evidenceFingerprint:"a".repeat(64),verifiedAt:at,freshUntil:new Date(Date.now()+3600000).toISOString()}});assert.equal(done.health.state,"VALID");
  const replay=await owner.claimCredentialHealth({projectId:a,bindingId:binding.bindingId,action:"VERIFY_HEALTH",idempotencyKey:"health-1",actor:"owner",reason:"verify"});assert.equal(replay.created,false);assert.equal(replay.status,"COMPLETED");
  assert.equal((await owner.credentialDecisionItems(a)).some(x=>x.targetId===binding.bindingId),false);
  const exposed=JSON.stringify(await owner.credentialHealth(a));assert.doesNotMatch(exposed,/opaque-test-reference|access_token|refresh_token|client_secret/i);
});

test("normal operations require neither scripts nor direct database access",async()=>{
  const matrix=await owner.operationMatrix();assert.ok(matrix.normal.length>=10);assert.ok(matrix.normal.every(x=>x.uiAvailable&&x.apiAvailable&&!x.scriptRequired&&!x.directDbRequired&&!x.breakGlassOnly));
});

test("engineering tools remain explicit audited break-glass only",async()=>{
  const matrix=await owner.operationMatrix();assert.ok(matrix.breakGlass.length>=5);assert.ok(matrix.breakGlass.every(x=>x.classification==="BREAK_GLASS_ONLY"&&x.explicitEngineeringGuard&&x.auditRequired&&x.ownerAdminRequired));
});
