import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ArtifactIntegrityRepairStore, artifactPayloadHash, createPool, migrate, TargetedVerificationDispatcher, TargetedVerificationReevaluationRecoveryDispatcher } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

let pool;
const now = () => new Date().toISOString();

async function seed(projectId = `project-${randomUUID()}`) {
  const workflowId = `workflow-${randomUUID()}`;
  const artifactId = `artifact-${randomUUID()}`;
  const submissionKey = `submission-${randomUUID()}`;
  const timestamp = now();
  await pool.query(
    `INSERT INTO workflow_submissions(submission_key,workflow_id,directive,correlation_id,brand_id,definition,status,created_at,updated_at)
     VALUES($1,$2,'targeted fixture',$3,$4,$5::jsonb,'accepted',$6,$6)`,
    [submissionKey, workflowId, `correlation-${randomUUID()}`, projectId, JSON.stringify({ id: "fixture", version: 1, trigger: { kind: "manual", event: "fixture" }, entryStepId: "research", steps: [] }), timestamp],
  );
  await pool.query(
    `INSERT INTO workflow_instances(workflow_id,definition_id,definition_version,state,context,ready,last_checkpoint_ref,created_at,updated_at)
     VALUES($1,'fixture',1,'PAUSED',$2::jsonb,'[]'::jsonb,NULL,$3,$3)`,
    [workflowId, JSON.stringify({ workflowId, correlationId: `correlation-${randomUUID()}`, data: { contentId: "content-fixture" }, outputs: {} }), timestamp],
  );
  await pool.query(`INSERT INTO workflow_steps(workflow_id,step_id,status,attempts,started_at,finished_at) VALUES($1,'research','COMPLETED',1,$2,$2)`, [workflowId, timestamp]);
  const candidateStories = [
    { candidateId: "candidate-1", topic: "A Nile-side perspective on ancient Egypt", keyClaims: ["The Nile supported settlement."] },
    { candidateId: "candidate-2", topic: "From Egyptian excavation to museum display", keyClaims: ["Museums document excavation provenance."] },
  ];
  await pool.query(
    `INSERT INTO artifacts(artifact_id,workflow_id,kind,producer_agent,correlation_id,status,payload,content_type,schema_version,created_at)
     VALUES($1,$2,'research_report','research',$3,'completed',$4::jsonb,'application/json','1.0',$5)`,
    [artifactId, workflowId, `correlation-${randomUUID()}`, JSON.stringify({ reportId: randomUUID(), taskDescription: "fixture", summary: "fixture", sources: [], candidateStories }), timestamp],
  );
  return { projectId, workflowId, artifactId, submissionKey };
}

function input(seeded, suffix = randomUUID()) {
  return { idempotencyKey: `owner-targeted-${suffix}`, ...seeded, selectedCandidateIds: ["candidate-1", "candidate-2"],
    verificationObjectives: { "candidate-1": "corroborate existing claim", "candidate-2": "corroborate existing claim" },
    maxVerificationRetrievalCalls: 2, maxReevaluationTextCalls: 1, authorizedBy: "owner", rationale: "provider-free fixture" };
}

before(async () => {
  assertTestDatabaseIsolation();
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  await pool.query(
    `TRUNCATE targeted_verification_reevaluation_recoveries,
              targeted_verification_dispatches,
              artifact_integrity_repairs,
              workflow_submissions, workflow_jobs, workflow_instances, workflow_steps,
              workflow_checkpoints, artifacts, capability_executions, execution_evidence,
              decisions, production_call_reservations
     RESTART IDENTITY CASCADE`,
  );
});
after(async () => { if (pool) await pool.end(); });

test("L/M: exact and concurrent identical dispatches create one durable job", async () => {
  const seeded = await seed();
  const dispatcher = new TargetedVerificationDispatcher(pool);
  const request = input(seeded);
  const [first, second] = await Promise.all([dispatcher.authorizeAndDispatch(request), dispatcher.authorizeAndDispatch(request)]);
  assert.equal([first.created, second.created].filter(Boolean).length, 1);
  assert.equal(first.dispatch.dispatchId, second.dispatch.dispatchId);
  assert.equal(first.dispatch.jobId, second.dispatch.jobId);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS count FROM workflow_jobs WHERE workflow_id=$1`, [seeded.workflowId])).rows[0].count, 1);
  await dispatcher.markRunning(first.dispatch.dispatchId);
  await dispatcher.settle(first.dispatch.dispatchId, "COMPLETED", "targeted-revision-1");
  const replay = await dispatcher.authorizeAndDispatch(request);
  assert.equal(replay.created, false);
  assert.equal(replay.dispatch.status, "COMPLETED");
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS count FROM workflow_jobs WHERE workflow_id=$1`, [seeded.workflowId])).rows[0].count, 1);
});

async function seedFailedTargetedSource() {
  const seeded=await seed("morroway"),sourceDispatchId=`targeted-verification-${randomUUID()}`,nowAt=now();
  await pool.query(`INSERT INTO targeted_verification_dispatches(dispatch_id,idempotency_key,project_id,workflow_id,artifact_id,selected_candidate_ids,verification_objectives,max_verification_retrieval_calls,max_reevaluation_text_calls,authorization_status,status,provenance,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,'{}'::jsonb,2,1,'OWNER_APPROVED','FAILED','{}'::jsonb,$7,$7)`,[sourceDispatchId,`source-${randomUUID()}`,seeded.projectId,seeded.workflowId,seeded.artifactId,JSON.stringify(["candidate-1","candidate-2"]),nowAt]);
  for(const candidateId of ["candidate-1","candidate-2"]){const resultId=`web-search-result-${sourceDispatchId}:verify-${candidateId}-q1`,evidenceId=`evidence-${resultId}`,idem=`source:${sourceDispatchId}:${candidateId}:retrieval`;const evidence={evidenceId,workflowId:seeded.workflowId,correlationId:sourceDispatchId,succeeded:true};const payload={status:"success",resultId,capabilityId:"web.search",output:{results:[]},evidence};await pool.query(`INSERT INTO capability_executions(result_id,workflow_id,correlation_id,capability_id,agent_id,status,evidence_id,idempotency_key,executed_at,payload) VALUES($1,$2,$3,'web.search','research','success',$4,$5,$6,$7::jsonb)`,[resultId,seeded.workflowId,sourceDispatchId,evidenceId,idem,nowAt,JSON.stringify(payload)]);await pool.query(`INSERT INTO execution_evidence(evidence_id,workflow_id,correlation_id,capability_id,agent_id,executed_at,succeeded,idempotency_key,payload) VALUES($1,$2,$3,'web.search','research',$4,TRUE,$5,$6::jsonb)`,[evidenceId,seeded.workflowId,sourceDispatchId,nowAt,idem,JSON.stringify(evidence)]);}
  return{...seeded,sourceDispatchId,contentId:"content-fixture"};
}

test("Recovery A/I/J/K/L/M: concurrent and exact replay create one reevaluation-only job without budget mutation",async()=>{
  const seeded=await seedFailedTargetedSource(),dispatcher=new TargetedVerificationReevaluationRecoveryDispatcher(pool);
  const request={authorizationKey:`recovery-${randomUUID()}`,sourceDispatchId:seeded.sourceDispatchId,projectId:seeded.projectId,contentId:seeded.contentId,workflowId:seeded.workflowId,artifactId:seeded.artifactId,selectedCandidateIds:["candidate-1","candidate-2"],maxReevaluationTextCalls:1,authorizedBy:"owner",rationale:"provider-free"};
  const before=(await pool.query(`SELECT call_kind,limit_count,reserved_count,consumed_count FROM production_phase_call_budgets WHERE project_id='morroway' ORDER BY call_kind`)).rows;
  const [one,two]=await Promise.all([dispatcher.authorizeAndDispatch(request),dispatcher.authorizeAndDispatch(request)]);
  assert.equal([one.created,two.created].filter(Boolean).length,1);assert.equal(one.recovery.jobId,two.recovery.jobId);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM workflow_jobs WHERE workflow_id=$1`,[seeded.workflowId])).rows[0].n,1);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM production_call_reservations WHERE workflow_id=$1`,[seeded.workflowId])).rows[0].n,0);
  assert.deepEqual((await pool.query(`SELECT call_kind,limit_count,reserved_count,consumed_count FROM production_phase_call_budgets WHERE project_id='morroway' ORDER BY call_kind`)).rows,before);
  await dispatcher.markRunning(one.recovery.recoveryId);await dispatcher.settle(one.recovery.recoveryId,"COMPLETED","revision-1",undefined,{model:"openai/gpt-6-luna"});
  const replay=await dispatcher.authorizeAndDispatch(request);assert.equal(replay.created,false);assert.equal(replay.recovery.status,"COMPLETED");
  assert.equal((await pool.query(`SELECT state FROM workflow_instances WHERE workflow_id=$1`,[seeded.workflowId])).rows[0].state,"PAUSED");
});

test("Recovery C: missing candidate evidence fails before job creation",async()=>{
  const seeded=await seedFailedTargetedSource();await pool.query(`DELETE FROM execution_evidence WHERE evidence_id=$1`,[`evidence-web-search-result-${seeded.sourceDispatchId}:verify-candidate-2-q1`]);const dispatcher=new TargetedVerificationReevaluationRecoveryDispatcher(pool);
  await assert.rejects(()=>dispatcher.authorizeAndDispatch({authorizationKey:`recovery-${randomUUID()}`,sourceDispatchId:seeded.sourceDispatchId,projectId:seeded.projectId,contentId:seeded.contentId,workflowId:seeded.workflowId,artifactId:seeded.artifactId,selectedCandidateIds:["candidate-1","candidate-2"],maxReevaluationTextCalls:1,authorizedBy:"owner",rationale:"provider-free"}),/EVIDENCE_MISSING:candidate-2/);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM workflow_jobs WHERE workflow_id=$1`,[seeded.workflowId])).rows[0].n,0);
});

test("B: an unknown candidate fails before authorization or job creation", async () => {
  const seeded = await seed();
  const dispatcher = new TargetedVerificationDispatcher(pool);
  const request = { ...input(seeded), selectedCandidateIds: ["candidate-404"], maxVerificationRetrievalCalls: 1 };
  await assert.rejects(() => dispatcher.authorizeAndDispatch(request), /UNKNOWN_CANDIDATE/);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS count FROM targeted_verification_dispatches WHERE workflow_id=$1`, [seeded.workflowId])).rows[0].count, 0);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS count FROM workflow_jobs WHERE workflow_id=$1`, [seeded.workflowId])).rows[0].count, 0);
});

test("C: artifact/workflow mismatch fails before authorization or job creation", async () => {
  const selected = await seed();
  const other = await seed(selected.projectId);
  const dispatcher = new TargetedVerificationDispatcher(pool);
  const request = input({ ...selected, artifactId: other.artifactId });
  await assert.rejects(() => dispatcher.authorizeAndDispatch(request), /ARTIFACT_SCOPE_MISMATCH/);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS count FROM targeted_verification_dispatches WHERE workflow_id=$1`, [selected.workflowId])).rows[0].count, 0);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS count FROM workflow_jobs WHERE workflow_id=$1`, [selected.workflowId])).rows[0].count, 0);
});

test("J/K: audited artifact revision preserves history and PAUSED Owner Review state", async () => {
  const seeded = await seed();
  const store = new ArtifactIntegrityRepairStore(pool);
  const prior = (await pool.query(`SELECT payload FROM artifacts WHERE artifact_id=$1`, [seeded.artifactId])).rows[0].payload;
  const request = { repairId: `revision-${randomUUID()}`, artifactId: seeded.artifactId, workflowId: seeded.workflowId,
    recoveryExecutionId: `targeted-${randomUUID()}`, repairKind: `TARGETED_VERIFICATION_REVISION:${randomUUID()}`,
    authorizationRef: "owner:test", evidenceRef: "provider-free:test", expectedPriorPayloadHash: artifactPayloadHash(prior),
    repairedPayload: { ...prior, targetedVerification: { mode: "TARGETED_VERIFICATION", selectedCandidateIds: ["candidate-1", "candidate-2"] } } };
  const applied = await store.repairResearchArtifact(request);
  const replay = await store.repairResearchArtifact(request);
  assert.equal(applied.outcome, "APPLIED");
  assert.equal(replay.outcome, "ALREADY_REPAIRED");
  assert.equal(replay.mutated, false);
  assert.equal((await pool.query(`SELECT state FROM workflow_instances WHERE workflow_id=$1`, [seeded.workflowId])).rows[0].state, "PAUSED");
  assert.equal((await pool.query(`SELECT status FROM workflow_steps WHERE workflow_id=$1 AND step_id='research'`, [seeded.workflowId])).rows[0].status, "COMPLETED");
  const revised = (await pool.query(`SELECT payload FROM artifacts WHERE artifact_id=$1`, [seeded.artifactId])).rows[0].payload;
  assert.equal(revised.artifactIntegrityRepair.repairId, request.repairId);
  assert.equal((await pool.query(`SELECT COUNT(*)::int AS count FROM artifact_integrity_repairs WHERE artifact_id=$1`, [seeded.artifactId])).rows[0].count, 1);
});
