import test from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, ProductionCallBudgetStore } from "../dist/index.js";

const TEST_URL = process.env.TEST_DATABASE_URL ?? (() => { if (!process.env.DATABASE_URL) return "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test"; const value = new URL(process.env.DATABASE_URL); value.pathname = "/ai_media_factory_test"; return value.toString(); })();

test("production per-call reservation is atomic, idempotent, reconciled, and fail-closed", async () => {
  const pool = createPool({ connectionString: TEST_URL });
  await migrate(pool);
  const project = `phase1-budget-${Date.now()}`;
  await pool.query(`INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at) VALUES($1,'PRE_MEDIA_PHASE','text_agent',1,0,0,0,TRUE,$2)`, [project, new Date().toISOString()]);
  const store = new ProductionCallBudgetStore(pool);
  const input = { projectId: project, workflowId: "wf", phase: "PRE_MEDIA_PHASE", stage: "writer", role: "writer", callKind: "text_agent", idempotencyKey: `${project}:writer:v1` };
  const results = await Promise.allSettled([store.reserve(input), store.reserve({ ...input, idempotencyKey: `${project}:writer:v2` })]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  const reservation = results.find((result) => result.status === "fulfilled").value;
  await store.reconcile({ reservationId: reservation.reservationId, providerSubmissionStarted: true, success: true, calculableCostUsd: 0.001 });
  const budget = (await store.budgets(project))[0];
  assert.deepEqual({ reserved: budget.reserved, consumed: budget.consumed, remaining: budget.remaining }, { reserved: 0, consumed: 1, remaining: 0 });
  await assert.rejects(store.reserve(input), /DUPLICATE_BILLABLE_EXECUTION_BLOCKED/);
  await pool.query(`DELETE FROM production_call_reservations WHERE project_id=$1`, [project]);
  await pool.query(`DELETE FROM production_phase_call_budgets WHERE project_id=$1`, [project]);
  await pool.end();
});

async function repairFixture({ cost = null } = {}) {
  const pool = createPool({ connectionString: TEST_URL });
  await migrate(pool);
  const project = `phase1-repair-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const workflowId = `wf-${project}`;
  await pool.query(`INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at) VALUES($1,'PRE_MEDIA_PHASE','text_agent',15,0,14,0,TRUE,$2)`, [project, new Date().toISOString()]);
  const store = new ProductionCallBudgetStore(pool);
  const reserved = { reservationId: `production-call-${project}`, idempotencyKey: `${project}:recovery:test:synthesis` };
  await pool.query(`INSERT INTO production_call_reservations(reservation_id,idempotency_key,project_id,workflow_id,phase,stage,role,call_kind,status,provider_submission_started,calculable_cost_usd,reserved_at,reconciled_at,provenance) VALUES($1,$2,$3,$4,'PRE_MEDIA_PHASE','research','research','text_agent','FAILED_AFTER_SUBMISSION',TRUE,$5,$6,$6,'{}')`, [reserved.reservationId, reserved.idempotencyKey, project, workflowId, cost, new Date().toISOString()]);
  const input = { reservationId: reserved.reservationId, idempotencyKey: reserved.idempotencyKey, workflowId, stepId: "research", callLeg: "FINAL_SYNTHESIS", expectedStatus: "FAILED_AFTER_SUBMISSION", repairId: `repair-${project}`, authorizationRef: "owner-test", evidenceRef: "event-test", reason: "no call-specific fetch event" };
  return { pool, project, workflowId, store, reserved, input, cleanup: async () => {
    await pool.query(`DELETE FROM execution_lifecycle_events WHERE workflow_id=$1`, [workflowId]);
    await pool.query(`DELETE FROM production_call_reservations WHERE project_id=$1`, [project]);
    await pool.query(`DELETE FROM production_phase_call_budgets WHERE project_id=$1`, [project]);
    await pool.end();
  } };
}

test("A/B: valid repair applies once and exact replay is a deterministic no-op", async () => {
  const fixture = await repairFixture();
  const first = await fixture.store.repairTransportOvercount(fixture.input);
  const second = await fixture.store.repairTransportOvercount(fixture.input);
  assert.deepEqual(first, { outcome: "APPLIED", decremented: true, repairId: fixture.input.repairId, reservationId: fixture.reserved.reservationId });
  assert.deepEqual(second, { outcome: "ALREADY_REPAIRED", decremented: false, repairId: fixture.input.repairId, reservationId: fixture.reserved.reservationId });
  const [budget] = await fixture.store.budgets(fixture.project);
  assert.deepEqual({ consumed: budget.consumed, remaining: budget.remaining }, { consumed: 13, remaining: 2 });
  const [row] = await fixture.store.workflowEvidence(fixture.workflowId);
  assert.equal(row.status, "RELEASED_BEFORE_SUBMISSION");
  assert.equal(row.idempotency_key, fixture.reserved.idempotencyKey);
  assert.equal(row.provenance.accountingRepair.result, "APPLIED");
  await fixture.cleanup();
});

test("research retrieval overcount uses the same guarded idempotent repair primitive", async () => {
  const pool = createPool({ connectionString: TEST_URL });
  await migrate(pool);
  const project = `phase1-retrieval-repair-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const workflowId = `wf-${project}`;
  const reservationId = `production-call-${project}`;
  const idempotencyKey = `${workflowId}:research:research:v1:recovery:test:retrieval:1`;
  await pool.query(`INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at) VALUES($1,'PRE_MEDIA_PHASE','research',4,0,1,0,TRUE,$2)`, [project, new Date().toISOString()]);
  await pool.query(`INSERT INTO production_call_reservations(reservation_id,idempotency_key,project_id,workflow_id,phase,stage,role,call_kind,status,provider_submission_started,reserved_at,reconciled_at,provenance) VALUES($1,$2,$3,$4,'PRE_MEDIA_PHASE','research','research','research','FAILED_AFTER_SUBMISSION',TRUE,$5,$5,'{}')`, [reservationId, idempotencyKey, project, workflowId, new Date().toISOString()]);
  const store = new ProductionCallBudgetStore(pool);
  const input = { reservationId, idempotencyKey, workflowId, stepId: "research", callLeg: "RETRIEVAL", expectedStatus: "FAILED_AFTER_SUBMISSION", repairId: `repair-${project}`, authorizationRef: "owner-test", evidenceRef: "call-specific-lifecycle-test", reason: "no call-specific retrieval fetch event" };
  const first = await store.repairTransportOvercount(input);
  const replay = await store.repairTransportOvercount(input);
  assert.deepEqual(first, { outcome: "APPLIED", decremented: true, repairId: input.repairId, reservationId });
  assert.deepEqual(replay, { outcome: "ALREADY_REPAIRED", decremented: false, repairId: input.repairId, reservationId });
  assert.equal((await store.budgets(project))[0].consumed, 0);
  await pool.query(`DELETE FROM production_call_reservations WHERE project_id=$1`, [project]);
  await pool.query(`DELETE FROM production_phase_call_budgets WHERE project_id=$1`, [project]);
  await pool.end();
});

test("C: concurrent identical repairs perform exactly one decrement", async () => {
  const fixture = await repairFixture();
  const results = await Promise.all([fixture.store.repairTransportOvercount(fixture.input), fixture.store.repairTransportOvercount(fixture.input)]);
  assert.deepEqual(results.map((result) => result.outcome).sort(), ["ALREADY_REPAIRED", "APPLIED"]);
  assert.equal(results.filter((result) => result.decremented).length, 1);
  assert.equal((await fixture.store.budgets(fixture.project))[0].consumed, 13);
  await fixture.cleanup();
});

test("D: different repair identity or evidence is rejected after application", async () => {
  const fixture = await repairFixture();
  await fixture.store.repairTransportOvercount(fixture.input);
  await assert.rejects(fixture.store.repairTransportOvercount({ ...fixture.input, repairId: `${fixture.input.repairId}-different` }), /IDENTITY_CONFLICT/);
  await assert.rejects(fixture.store.repairTransportOvercount({ ...fixture.input, evidenceRef: "different-evidence" }), /IDENTITY_CONFLICT/);
  assert.equal((await fixture.store.budgets(fixture.project))[0].consumed, 13);
  await fixture.cleanup();
});

test("E: call-specific transport-start evidence rejects repair", async () => {
  const fixture = await repairFixture();
  await fixture.pool.query(`INSERT INTO execution_lifecycle_events(execution_id,workflow_id,stage,state,occurred_at,attempt_number,metadata) VALUES($1,$2,'research','FETCH_INVOCATION_STARTED',$3,1,$4)`, ["execution-test", fixture.workflowId, new Date().toISOString(), JSON.stringify({ reservationId: fixture.reserved.reservationId, idempotencyKey: fixture.reserved.idempotencyKey })]);
  await assert.rejects(fixture.store.repairTransportOvercount(fixture.input), /TRANSPORT_EVIDENCE_CONFLICT/);
  assert.equal((await fixture.store.budgets(fixture.project))[0].consumed, 14);
  await fixture.cleanup();
});

test("F: reservation cost or call-specific usage evidence rejects repair", async () => {
  const withCost = await repairFixture({ cost: 0.001 });
  await assert.rejects(withCost.store.repairTransportOvercount(withCost.input), /USAGE_COST_CONFLICT/);
  assert.equal((await withCost.store.budgets(withCost.project))[0].consumed, 14);
  await withCost.cleanup();
  const withUsage = await repairFixture();
  await withUsage.pool.query(`INSERT INTO execution_lifecycle_events(execution_id,workflow_id,stage,state,occurred_at,attempt_number,metadata) VALUES($1,$2,'research','PROVIDER_RESPONSE_RECEIVED',$3,1,$4)`, ["execution-test", withUsage.workflowId, new Date().toISOString(), JSON.stringify({ reservationId: withUsage.reserved.reservationId, usage: { inputTokens: 1 } })]);
  await assert.rejects(withUsage.store.repairTransportOvercount(withUsage.input), /USAGE_COST_CONFLICT/);
  await withUsage.cleanup();
});

test("G: wrong reservation, idempotency, workflow, step, or call leg is rejected", async () => {
  const fixture = await repairFixture();
  await assert.rejects(fixture.store.repairTransportOvercount({ ...fixture.input, reservationId: "production-call-wrong" }), /IDENTITY_MISMATCH/);
  await assert.rejects(fixture.store.repairTransportOvercount({ ...fixture.input, idempotencyKey: "wrong" }), /IDENTITY_MISMATCH/);
  await assert.rejects(fixture.store.repairTransportOvercount({ ...fixture.input, workflowId: "wf-wrong" }), /SCOPE_MISMATCH/);
  await assert.rejects(fixture.store.repairTransportOvercount({ ...fixture.input, stepId: "writer" }), /SCOPE_MISMATCH/);
  await assert.rejects(fixture.store.repairTransportOvercount({ ...fixture.input, callLeg: "DIRECTION" }), /SCOPE_MISMATCH/);
  assert.equal((await fixture.store.budgets(fixture.project))[0].consumed, 14);
  await fixture.cleanup();
});

test("unrelated reservation state remains rejected", async () => {
  const fixture = await repairFixture();
  await fixture.pool.query(`UPDATE production_call_reservations SET status='RELEASED_BEFORE_SUBMISSION',provider_submission_started=FALSE WHERE reservation_id=$1`, [fixture.reserved.reservationId]);
  await assert.rejects(fixture.store.repairTransportOvercount(fixture.input), /STATE_MISMATCH/);
  await fixture.cleanup();
});
