/**
 * Provider-free Golden Canary budget-envelope contract. Uses only the isolated
 * test database and the public OwnerAutonomyStore/ProductionCallBudgetStore
 * seams used by production operators and workers.
 */
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import {
  createPool,
  migrate,
  ControlPlaneStore,
  OwnerAutonomyStore,
  ProductionCallBudgetStore,
} from "../dist/index.js";

const TEST_URL = process.env.TEST_DATABASE_URL ?? (() => {
  if (!process.env.DATABASE_URL) return "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
  const value = new URL(process.env.DATABASE_URL);
  value.pathname = "/ai_media_factory_test";
  return value.toString();
})();
if (new URL(TEST_URL).pathname !== "/ai_media_factory_test") throw new Error("Golden Canary envelope tests require the isolated test database");

const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const PROJECT = `canary-envelope-${nonce}`;
const PHASE = `MORROWAY_GOLDEN_CANARY_TEST_${nonce.toUpperCase()}`;
const WORKFLOW = `wf-${nonce}`;
let pool;
let owner;
let budgets;

before(async () => {
  pool = createPool({ connectionString: TEST_URL });
  await migrate(pool);
  await new ControlPlaneStore(pool).registerProject({ projectId: PROJECT, displayName: "Canary Envelope Fixture" });
  owner = new OwnerAutonomyStore(pool);
  budgets = new ProductionCallBudgetStore(pool);
});

after(async () => {
  if (!pool) return;
  await pool.query(`DELETE FROM production_call_reservations WHERE project_id=$1`, [PROJECT]);
  await pool.query(`DELETE FROM production_phase_call_budgets WHERE project_id=$1`, [PROJECT]);
  await pool.query(`DELETE FROM owner_control_audit_events WHERE project_id=$1`, [PROJECT]);
  await pool.query(`DELETE FROM control_projects WHERE project_id=$1`, [PROJECT]);
  await pool.end();
});

test("Canary envelope separates scoped Research text authority from unrestricted non-Research text capacity", async () => {
  const envelope = await owner.createGoldenCanaryBudgetEnvelope({
    projectId: PROJECT,
    phase: PHASE,
    actor: "owner-test",
    reason: "one provider-free Golden Canary through AWAITING_APPROVAL",
  });

  assert.equal(envelope.authorization.action, "AUTHORIZE_GOLDEN_CANARY_BUDGET");
  const authorizationAudit = (await owner.auditEvents(PROJECT)).find(
    (event) => event.action === "AUTHORIZE_GOLDEN_CANARY_BUDGET" && event.subjectId === PHASE,
  );
  assert.equal(authorizationAudit.after.maxWorkflows, 1);
  assert.equal(authorizationAudit.after.maxRetries, 0);
  assert.equal(authorizationAudit.after.maxEndpoint, "AWAITING_APPROVAL");
  assert.equal(authorizationAudit.after.mediaAuthority, "NOT_GRANTED");
  assert.equal(authorizationAudit.after.publicationAuthority, "NOT_GRANTED");
  assert.deepEqual(
    (await budgets.budgets(PROJECT, PHASE)).map((row) => [row.callKind, row.limit, row.allowedCallLegs]),
    [
      ["image_generation", 1, []],
      ["private_publish", 0, []],
      ["public_publish", 0, []],
      ["research", 4, ["RETRIEVAL"]],
      ["research_text_agent", 2, ["DIRECTION", "FINAL_SYNTHESIS"]],
      ["text_agent", 8, null],
      ["wan_generation", 0, []],
    ],
  );

  const nonResearchStages = [
    ["orchestrator", "orchestrator"], ["ceo-recommendation", "ceo"],
    ["planner-synthesis", "planner"], ["writer", "writer"], ["scenes", "director"],
    ["visual-direction", "visual-director"], ["review", "review"], ["phase1-qa", "qa"],
  ];
  const nonResearchReservations = [];
  for (const [stage, role] of nonResearchStages) {
    const reservation = await budgets.reserve({
      projectId: PROJECT, workflowId: WORKFLOW, phase: PHASE, stage, role, callKind: "text_agent",
      idempotencyKey: `${WORKFLOW}:${stage}:text_agent:v1`,
    });
    assert.equal(reservation.callLeg, null, stage);
    nonResearchReservations.push(reservation);
  }

  const direction = await budgets.reserve({
    projectId: PROJECT, workflowId: WORKFLOW, phase: PHASE,
    stage: "research", role: "research", callKind: "research_text_agent", callLeg: "DIRECTION",
    idempotencyKey: `${WORKFLOW}:research:research_text_agent:v1`,
  });
  const synthesis = await budgets.reserve({
    projectId: PROJECT, workflowId: WORKFLOW, phase: PHASE,
    stage: "research", role: "research", callKind: "research_text_agent", callLeg: "FINAL_SYNTHESIS",
    idempotencyKey: `${WORKFLOW}:research:research_text_agent:v1:synthesis`,
  });

  for (const reservation of [...nonResearchReservations, direction, synthesis]) {
    await budgets.reconcile({ reservationId: reservation.reservationId, providerSubmissionStarted: true, success: true });
  }
  const rows = await budgets.budgets(PROJECT, PHASE);
  assert.equal(rows.find((row) => row.callKind === "text_agent").consumed, 8);
  assert.equal(rows.find((row) => row.callKind === "research_text_agent").consumed, 2);
  await assert.rejects(
    budgets.reserve({projectId:PROJECT,workflowId:WORKFLOW,phase:PHASE,stage:"orchestrator",role:"orchestrator",callKind:"text_agent",idempotencyKey:`${WORKFLOW}:orchestrator:text_agent:v1`}),
    /DUPLICATE_BILLABLE_EXECUTION_BLOCKED/,
  );
  await assert.rejects(
    owner.createGoldenCanaryBudgetEnvelope({
      projectId: PROJECT,
      phase: PHASE,
      actor: "owner-test",
      reason: "duplicate envelope must fail closed",
    }),
    /GOLDEN_CANARY_ENVELOPE_ALREADY_EXISTS/,
  );
  assert.equal((await budgets.budgets(PROJECT, PHASE)).length, 7);
});

test("Research text authority remains exact and fail-closed", async () => {
  const suffix = `${nonce}-negative`;
  const phases = {
    synthesisOnly: `SYNTHESIS_ONLY_${nonce.toUpperCase()}`,
    directionOnly: `DIRECTION_ONLY_${nonce.toUpperCase()}`,
    empty: `EMPTY_${nonce.toUpperCase()}`,
    noGeneral: `NO_GENERAL_${nonce.toUpperCase()}`,
  };
  const now = new Date().toISOString();
  for (const [phase, legs, limit] of [
    [phases.synthesisOnly, ["FINAL_SYNTHESIS"], 1],
    [phases.directionOnly, ["DIRECTION"], 1],
    [phases.empty, [], 1],
    [phases.noGeneral, ["DIRECTION", "FINAL_SYNTHESIS"], 2],
  ]) {
    await pool.query(
      `INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at,allowed_call_legs)
       VALUES($1,$2,'research_text_agent',$3,0,0,0,TRUE,$4,$5)`,
      [PROJECT,phase,limit,now,JSON.stringify(legs)],
    );
  }
  const reserveResearch = (phase, leg, name) => budgets.reserve({
    projectId:PROJECT,workflowId:`wf-${suffix}`,phase,stage:"research",role:"research",
    callKind:"research_text_agent",callLeg:leg,idempotencyKey:`${suffix}:${name}`,
  });
  await assert.rejects(reserveResearch(phases.synthesisOnly,"DIRECTION","wrong-direction"),/BUDGET_STAGE_NOT_AUTHORIZED/);
  await assert.rejects(reserveResearch(phases.directionOnly,"FINAL_SYNTHESIS","wrong-synthesis"),/BUDGET_STAGE_NOT_AUTHORIZED/);
  await assert.rejects(reserveResearch(phases.empty,"DIRECTION","empty"),/BUDGET_STAGE_NOT_AUTHORIZED/);
  await assert.rejects(reserveResearch(phases.directionOnly,"FAKE_CALL_LEG","fake"),/BUDGET_STAGE_NOT_AUTHORIZED/);
  await assert.rejects(
    budgets.reserve({projectId:PROJECT,workflowId:`wf-${suffix}`,phase:phases.noGeneral,stage:"orchestrator",role:"orchestrator",callKind:"text_agent",idempotencyKey:`${suffix}:no-general`}),
    /PRODUCTION_PHASE_BUDGET_UNAVAILABLE:text_agent/,
  );
  const first = await reserveResearch(phases.directionOnly,"DIRECTION","exhaust-one");
  await budgets.reconcile({reservationId:first.reservationId,providerSubmissionStarted:true,success:true});
  await assert.rejects(reserveResearch(phases.directionOnly,"DIRECTION","exhaust-two"),/PRODUCTION_PHASE_HARD_CAP_STOP:research_text_agent/);
});
