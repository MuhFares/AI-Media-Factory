import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { createPool, migrate, PostgresPersistence, PostgresQueue } from "@ai-media-factory/database";
import { createProductionTargetedVerificationRuntime, createProductionTargetedReevaluationRecoveryRuntime } from "../dist/index.js";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";

function testDatabaseUrl() {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const u = new URL(process.env.DATABASE_URL); u.pathname = "/ai_media_factory_test"; return u.toString();
}
const TEST_URL = testDatabaseUrl();
if (new URL(TEST_URL).pathname !== "/ai_media_factory_test") throw new Error("worker budget-phase test must use the isolated test database");

const CANARY = "MORROWAY_GOLDEN_CANARY_01";
const PROJECT = "morroway";
let pool, persistence, queue;
const submissions = [];

before(async () => {
  pool = createPool({ connectionString: TEST_URL }); await migrate(pool);
  persistence = new PostgresPersistence(pool); queue = new PostgresQueue(pool);
  const now = new Date().toISOString();
  for (const [phase, kind, limit] of [[CANARY, "research", 4], [CANARY, "text_agent", 10], ["PRE_MEDIA_PHASE", "research", 1], ["PRE_MEDIA_PHASE", "text_agent", 10]])
    await pool.query(`INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at) VALUES($1,$2,$3,$4,0,0,0,TRUE,$5) ON CONFLICT(project_id,phase,call_kind) DO UPDATE SET limit_count=EXCLUDED.limit_count,reserved_count=0,consumed_count=0,max_retries=0,active=TRUE,updated_at=EXCLUDED.updated_at`, [PROJECT, phase, kind, limit, now]);
  const definition = directiveToWorkflowDefinition("produce-pre-media");
  const contexts = [
    ["wf-canary-retention-bound", { budgetPhase: CANARY }],
    ["wf-canary-retention-legacy", {}],
  ];
  for (const [wf, extra] of contexts) {
    await queue.submit({ submissionKey: `retention-fixture:${wf}`, workflowId: wf, directive: "produce-pre-media", correlationId: `corr-${wf}`, brandId: PROJECT, definition, commandContext: { source: "TEST", projectId: PROJECT, productionPhase: "PRE_MEDIA_PHASE", ...extra }, status: "submitted" });
    submissions.push(wf);
  }
});
after(async () => {
  if (pool) {
    if (submissions.length) await pool.query(`DELETE FROM production_call_reservations WHERE workflow_id = ANY($1::text[])`, [submissions]);
    if (submissions.length) await pool.query(`DELETE FROM workflow_submissions WHERE workflow_id = ANY($1::text[])`, [submissions]);
    await pool.end();
  }
});

test("F1. targeted-verification reservation retains the bound canary phase", async (t) => {
  const rt = createProductionTargetedVerificationRuntime({ pool, persistence, providerBoundary: {} });
  const r = await rt.reserve({ dispatch: { projectId: PROJECT, workflowId: "wf-canary-retention-bound" }, callKind: "research", idempotencyKey: "retention:f1:1", callLeg: "TEST" });
  assert.ok(r.reservationId);
  const row = await pool.query(`SELECT phase FROM production_call_reservations WHERE reservation_id=$1`, [r.reservationId]);
  assert.equal(row.rows[0].phase, CANARY);
  await rt.reconcile({ reservationId: r.reservationId, transportStarted: false, success: false });
});

test("F2. targeted-verification reservation keeps the legacy fallback without a bound phase", async () => {
  const rt = createProductionTargetedVerificationRuntime({ pool, persistence, providerBoundary: {} });
  const r = await rt.reserve({ dispatch: { projectId: PROJECT, workflowId: "wf-canary-retention-legacy" }, callKind: "research", idempotencyKey: "retention:f2:1", callLeg: "TEST" });
  const row = await pool.query(`SELECT phase FROM production_call_reservations WHERE reservation_id=$1`, [r.reservationId]);
  assert.equal(row.rows[0].phase, "PRE_MEDIA_PHASE");
  await rt.reconcile({ reservationId: r.reservationId, transportStarted: false, success: false });
});

test("F3. reevaluation-recovery reservation retains the bound canary phase", async () => {
  const rt = createProductionTargetedReevaluationRecoveryRuntime({ pool, persistence });
  const r = await rt.reserveText({ recovery: { projectId: PROJECT, workflowId: "wf-canary-retention-bound" }, idempotencyKey: "retention:f3:1", route: { provider: "openrouter", model: "fixture", routingVersionId: "rv", priceSnapshotId: "ps" } });
  const row = await pool.query(`SELECT phase FROM production_call_reservations WHERE reservation_id=$1`, [r.reservationId]);
  assert.equal(row.rows[0].phase, CANARY);
  await rt.reconcile({ reservationId: r.reservationId, transportStarted: false, success: false });
});
