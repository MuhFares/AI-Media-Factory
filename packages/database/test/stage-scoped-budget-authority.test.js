/**
 * Provider-free stage-scoped budget authority matrix. Isolated TEST database
 * only; never production. Proves reserve-path call-leg enforcement, legacy
 * compatibility, idempotency preservation, and the synthesis-probe fixture.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, ProductionCallBudgetStore, OwnerAutonomyStore, ControlPlaneStore, normalizeAllowedCallLegs, BUDGET_CALL_LEG_PATTERN } from "../dist/index.js";

const TEST_URL = process.env.TEST_DATABASE_URL ?? (() => { if (!process.env.DATABASE_URL) return "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test"; const value = new URL(process.env.DATABASE_URL); value.pathname = "/ai_media_factory_test"; return value.toString(); })();
if (new URL(TEST_URL).pathname !== "/ai_media_factory_test") throw new Error("stage-scope tests must use the isolated test database");

const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PROJECT = `stage-scope-${nonce}`;
const LEGACY = "STAGE_SCOPE_LEGACY";
const SCOPED = "STAGE_SCOPE_SYNTHESIS_ONLY";
const FIXTURE = "MORROWAY_SYNTHESIS_PROBE_TEST_FIXTURE";
let pool, store, keySeq = 0;
const key = (name) => `${PROJECT}:${name}:${++keySeq}`;
const baseReserve = (phase, stage, role, callKind, idem, callLeg) => ({
  projectId: PROJECT, workflowId: `wf-${PROJECT}`, phase, stage, role, callKind,
  ...(callLeg === undefined ? {} : { callLeg }), idempotencyKey: idem,
});

before(async () => {
  pool = createPool({ connectionString: TEST_URL });
  await migrate(pool);
  await new ControlPlaneStore(pool).registerProject({ projectId: PROJECT, displayName: "Stage Scope Fixture" });
  const now = new Date().toISOString();
  await pool.query(`INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at) VALUES($1,$2,'text_agent',10,0,0,0,TRUE,$3)`, [PROJECT, LEGACY, now]);
  await pool.query(`INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at,allowed_call_legs) VALUES($1,$2,'text_agent',1,0,0,0,TRUE,$3,$4)`, [PROJECT, SCOPED, now, JSON.stringify(["FINAL_SYNTHESIS"])]);
  await pool.query(`INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at) VALUES($1,$2,'research',0,0,0,0,TRUE,$3)`, [PROJECT, SCOPED, now]);
  await pool.query(`INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at,allowed_call_legs) VALUES($1,$2,'text_agent',1,0,0,0,TRUE,$3,$4)`, [PROJECT, FIXTURE, now, JSON.stringify(["FINAL_SYNTHESIS"])]);
  store = new ProductionCallBudgetStore(pool);
});

after(async () => {
  if (pool) {
    await pool.query(`DELETE FROM production_call_reservations WHERE project_id=$1`, [PROJECT]);
    await pool.query(`DELETE FROM production_phase_call_budgets WHERE project_id=$1`, [PROJECT]);
    await pool.query(`DELETE FROM owner_control_audit_events WHERE project_id=$1`, [PROJECT]);
    await pool.query(`DELETE FROM control_projects WHERE project_id=$1`, [PROJECT]);
    await pool.end();
  }
});

async function counters(phase, kind) {
  const [b] = (await store.budgets(PROJECT, phase)).filter((x) => x.callKind === kind);
  return { reserved: b.reserved, consumed: b.consumed, remaining: b.remaining };
}
async function reservationCount(phase) {
  return (await pool.query(`SELECT count(*)::int AS n FROM production_call_reservations WHERE project_id=$1 AND phase=$2`, [PROJECT, phase])).rows[0].n;
}

test("migration is additive: allowed_call_legs column exists, legacy rows read NULL scope", async () => {
  const col = await pool.query(`SELECT data_type FROM information_schema.columns WHERE table_name='production_phase_call_budgets' AND column_name='allowed_call_legs'`);
  assert.equal(col.rowCount, 1);
  const [legacy] = (await store.budgets(PROJECT, LEGACY)).filter((b) => b.callKind === "text_agent");
  assert.equal(legacy.allowedCallLegs, null);
  const [scoped] = (await store.budgets(PROJECT, SCOPED)).filter((b) => b.callKind === "text_agent");
  assert.deepEqual(scoped.allowedCallLegs, ["FINAL_SYNTHESIS"]);
});

test("normalizeAllowedCallLegs: null passthrough, array validation, empty means none", async () => {
  assert.equal(normalizeAllowedCallLegs(null), null);
  assert.deepEqual(normalizeAllowedCallLegs(["FINAL_SYNTHESIS"]), ["FINAL_SYNTHESIS"]);
  assert.deepEqual(normalizeAllowedCallLegs([]), []);
  assert.throws(() => normalizeAllowedCallLegs({}), /BUDGET_STAGE_SCOPE_INVALID/);
  assert.throws(() => normalizeAllowedCallLegs(["ok", 7]), /BUDGET_STAGE_SCOPE_INVALID/);
  assert.throws(() => normalizeAllowedCallLegs(["lowercase"]), /BUDGET_STAGE_SCOPE_INVALID/);
  assert.ok(BUDGET_CALL_LEG_PATTERN.test("FINAL_SYNTHESIS"));
});

test("A. legacy unrestricted budget allows existing stages with and without legs", async () => {
  for (const [stage, leg] of [["orchestrator", undefined], ["research", "DIRECTION"], ["ceo", undefined], ["writer", undefined]]) {
    const r = await store.reserve(baseReserve(LEGACY, stage, stage, "text_agent", key(`legacy-${stage}`), leg));
    assert.equal(r.status, "RESERVED");
  }
});

test("B. synthesis-only budget allows FINAL_SYNTHESIS and records leg identity", async () => {
  const r = await store.reserve(baseReserve(SCOPED, "research", "research", "text_agent", key("syn-allow"), "FINAL_SYNTHESIS"));
  assert.equal(r.status, "RESERVED");
  assert.equal(r.callLeg, "FINAL_SYNTHESIS");
  const row = (await pool.query(`SELECT provenance FROM production_call_reservations WHERE reservation_id=$1`, [r.reservationId])).rows[0];
  assert.equal(row.provenance.callLeg, "FINAL_SYNTHESIS");
  await store.reconcile({ reservationId: r.reservationId, providerSubmissionStarted: false, success: false });
});

test("C-I. synthesis-only budget rejects orchestrator, direction, ceo, writer, scenes, visual-direction, review", async () => {
  const cases = [
    ["orchestrator", "orchestrator", undefined],
    ["research", "research", "DIRECTION"],
    ["ceo", "ceo", undefined],
    ["writer", "writer", undefined],
    ["scenes", "director", undefined],
    ["visual-direction", "visual-director", undefined],
    ["review", "review", undefined],
  ];
  for (const [stage, role, leg] of cases) {
    await assert.rejects(
      store.reserve(baseReserve(SCOPED, stage, role, "text_agent", key(`rej-${stage}`), leg)),
      /BUDGET_STAGE_NOT_AUTHORIZED:text_agent/,
      stage,
    );
  }
});

test("J. missing leg on a scoped budget rejects even with a valid stage", async () => {
  await assert.rejects(
    store.reserve(baseReserve(SCOPED, "research", "research", "text_agent", key("no-leg"))),
    /BUDGET_STAGE_NOT_AUTHORIZED:text_agent/,
  );
});

test("K. unknown and non-canonical legs reject", async () => {
  await assert.rejects(store.reserve(baseReserve(SCOPED, "research", "research", "text_agent", key("unk"), "SOMETHING_ELSE")), /BUDGET_STAGE_NOT_AUTHORIZED/);
  await assert.rejects(store.reserve(baseReserve(SCOPED, "research", "research", "text_agent", key("lower"), "final_synthesis")), /BUDGET_STAGE_NOT_AUTHORIZED/);
  await assert.rejects(store.reserve(baseReserve(SCOPED, "research", "research", "text_agent", key("bad"), "NO!!")), /BUDGET_STAGE_NOT_AUTHORIZED/);
});

test("L-M. rejected unauthorized stage consumes zero capacity and creates zero reservation", async () => {
  const before = await counters(SCOPED, "text_agent");
  const rowsBefore = await reservationCount(SCOPED);
  await assert.rejects(store.reserve(baseReserve(SCOPED, "writer", "writer", "text_agent", key("zero"))), /BUDGET_STAGE_NOT_AUTHORIZED/);
  assert.deepEqual(await counters(SCOPED, "text_agent"), before);
  assert.equal(await reservationCount(SCOPED), rowsBefore);
});

test("N-O. authorized synthesis consumes exactly one unit, second rejects with normal exhaustion", async () => {
  const r = await store.reserve(baseReserve(SCOPED, "research", "research", "text_agent", key("one"), "FINAL_SYNTHESIS"));
  assert.deepEqual(await counters(SCOPED, "text_agent"), { reserved: 1, consumed: 0, remaining: 0 });
  await assert.rejects(store.reserve(baseReserve(SCOPED, "research", "research", "text_agent", key("two"), "FINAL_SYNTHESIS")), /PRODUCTION_PHASE_HARD_CAP_STOP:text_agent/);
  await store.reconcile({ reservationId: r.reservationId, providerSubmissionStarted: true, success: true });
  assert.deepEqual(await counters(SCOPED, "text_agent"), { reserved: 0, consumed: 1, remaining: 0 });
});

test("P-Q. idempotent repeat does not double-spend; same key cannot change leg", async () => {
  const idem = key("idem");
  const start = await counters(LEGACY, "text_agent");
  const r = await store.reserve(baseReserve(LEGACY, "research", "research", "text_agent", idem, "FINAL_SYNTHESIS"));
  await assert.rejects(store.reserve(baseReserve(LEGACY, "research", "research", "text_agent", idem, "FINAL_SYNTHESIS")), /PRODUCTION_CALL_RESERVATION_AMBIGUOUS/);
  assert.deepEqual(await counters(LEGACY, "text_agent"), { reserved: start.reserved + 1, consumed: start.consumed, remaining: start.remaining - 1 });
  await store.reconcile({ reservationId: r.reservationId, providerSubmissionStarted: true, success: true });
  await assert.rejects(store.reserve(baseReserve(LEGACY, "research", "research", "text_agent", idem, "DIRECTION")), /DUPLICATE_BILLABLE_EXECUTION_BLOCKED/);
  assert.deepEqual(await counters(LEGACY, "text_agent"), { reserved: start.reserved, consumed: start.consumed + 1, remaining: start.remaining - 1 });
});

test("R. zero-capacity categories remain unusable", async () => {
  await assert.rejects(store.reserve(baseReserve(SCOPED, "research", "research", "research", key("zero-cap"), "RETRIEVAL")), /PRODUCTION_PHASE_HARD_CAP_STOP:research/);
});

test("S-T. legacy full lifecycle unchanged; reconcile preserves stage and leg identity", async () => {
  const idem = key("legacy-life");
  const r = await store.reserve(baseReserve(LEGACY, "ceo", "ceo", "text_agent", idem));
  await store.reconcile({ reservationId: r.reservationId, providerSubmissionStarted: true, success: false });
  const row = (await pool.query(`SELECT stage,role,status,provenance FROM production_call_reservations WHERE reservation_id=$1`, [r.reservationId])).rows[0];
  assert.equal(row.stage, "ceo");
  assert.equal(row.role, "ceo");
  assert.equal(row.status, "FAILED_AFTER_SUBMISSION");
  const idem2 = key("legacy-leg");
  const r2 = await store.reserve(baseReserve(LEGACY, "research", "research", "text_agent", idem2, "DIRECTION"));
  await store.reconcile({ reservationId: r2.reservationId, providerSubmissionStarted: false, success: false });
  const row2 = (await pool.query(`SELECT stage,provenance FROM production_call_reservations WHERE reservation_id=$1`, [r2.reservationId])).rows[0];
  assert.equal(row2.stage, "research");
  assert.equal(row2.provenance.callLeg, "DIRECTION");
});

test("setBudget stores scope at creation and preserves it on limit maintenance", async () => {
  const owner = new OwnerAutonomyStore(pool);
  const created = await owner.setBudget({ projectId: PROJECT, phase: "STAGE_SCOPE_SETBUDGET", callKind: "text_agent", limit: 1, maxRetries: 0, actor: "test", reason: "scope test", allowedCallLegs: ["FINAL_SYNTHESIS"] });
  assert.equal(created.budget.limit, 1);
  let rows = await pool.query(`SELECT allowed_call_legs FROM production_phase_call_budgets WHERE project_id=$1 AND phase=$2 AND call_kind=$3`, [PROJECT, "STAGE_SCOPE_SETBUDGET", "text_agent"]);
  assert.deepEqual(rows.rows[0].allowed_call_legs, ["FINAL_SYNTHESIS"]);
  await owner.setBudget({ projectId: PROJECT, phase: "STAGE_SCOPE_SETBUDGET", callKind: "text_agent", limit: 5, maxRetries: 0, actor: "test", reason: "limit maintenance must not widen scope" });
  rows = await pool.query(`SELECT allowed_call_legs,limit_count FROM production_phase_call_budgets WHERE project_id=$1 AND phase=$2 AND call_kind=$3`, [PROJECT, "STAGE_SCOPE_SETBUDGET", "text_agent"]);
  assert.deepEqual(rows.rows[0].allowed_call_legs, ["FINAL_SYNTHESIS"]);
  assert.equal(Number(rows.rows[0].limit_count), 5);
  await assert.rejects(owner.setBudget({ projectId: PROJECT, phase: "STAGE_SCOPE_BAD", callKind: "text_agent", limit: 1, maxRetries: 0, actor: "test", reason: "bad scope", allowedCallLegs: ["nope!!"] }), /BUDGET_STAGE_SCOPE_INVALID/);
});

test("probe fixture: synthesis ALLOW, writer and orchestrator REJECT, scope visible", async () => {
  const [row] = (await store.budgets(PROJECT, FIXTURE)).filter((b) => b.callKind === "text_agent");
  assert.deepEqual(row.allowedCallLegs, ["FINAL_SYNTHESIS"]);
  assert.equal(row.remaining, 1);
  const okRes = await store.reserve(baseReserve(FIXTURE, "research", "research", "text_agent", key("probe-syn"), "FINAL_SYNTHESIS"));
  assert.equal(okRes.status, "RESERVED");
  await assert.rejects(store.reserve(baseReserve(FIXTURE, "writer", "writer", "text_agent", key("probe-writer"))), /BUDGET_STAGE_NOT_AUTHORIZED/);
  await assert.rejects(store.reserve(baseReserve(FIXTURE, "orchestrator", "orchestrator", "text_agent", key("probe-orch"))), /BUDGET_STAGE_NOT_AUTHORIZED/);
  await store.reconcile({ reservationId: okRes.reservationId, providerSubmissionStarted: false, success: false });
  assert.deepEqual((await counters(FIXTURE, "text_agent")).remaining, 1);
});
