import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore, ContentStore, LifecycleStore, ChannelStore, AutomationStore, ProductionCallBudgetStore, ProductionModelRoutingStore, OwnerAutonomyStore } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";

process.env.AMF_OWNER_TOKEN = "test-owner-token";
process.env.TEXT_AGENT_PROVIDER = "agentrouter";
process.env.OPENAI_API_KEY = "fixture";
process.env.ANTHROPIC_AUTH_TOKEN = "fixture";
process.env.SEARCH_API_SERPER = "fixture";
process.env.OPENROUTER_API_KEY = "fixture";
process.env.RUNPOD_API_KEY = "fixture";
process.env.RUNPOD_ZIMAGE_ENDPOINT_ID = "fixture-zimage";
process.env.RUNPOD_VIDEO_ENDPOINT_ID = "fixture-wan";
process.env.VOICETUT_TTS_ENDPOINT_ID = "fixture-voice";
const AUTH = { Authorization: "Bearer test-owner-token" };
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? (() => { if (!process.env.DATABASE_URL) return "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test"; const u = new URL(process.env.DATABASE_URL); u.pathname = "/ai_media_factory_test"; return u.toString(); })();
const CANARY_PHASE = "MORROWAY_GOLDEN_CANARY_01";
const SCOPED_CANARY_PHASE = "MORROWAY_GOLDEN_CANARY_SCOPED_TEST";
const CYCLE_PHASE = "MORROWAY_PRODUCTION_CYCLE_01_PRE_MEDIA";

let pool, server, base, persistence, queue, budgets;
async function req(path, options = {}) { const res = await fetch(`${base}${path}`, { headers: { "Content-Type": "application/json", ...AUTH }, ...options }); return { status: res.status, body: await res.json() }; }
const briefFor = (overrides = {}) => ({
  topic: "Golden canary phase wiring fixture topic", objective: "Prove explicit budget-phase resolution without providers",
  targetPlatform: "youtube", format: "short", targetAudience: "global curious adults", contentType: "historical_pov",
  language: "en", targetDurationSeconds: 30, sceneTarget: 1, researchRequirement: "required", characterRequirement: "none",
  identityCriticalHuman: false, productionCycle: "MORROWAY_PRODUCTION_CYCLE_01", ...overrides,
});
const createdIds = { contents: [], workflows: [], reservations: [] };

before(async () => {
  if (DATABASE_URL === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");
  pool = createPool({ connectionString: DATABASE_URL }); await migrate(pool);
  await pool.query(`TRUNCATE publication_preparations,content_review_decisions,content_visual_quality_reviews,content_revision_requests,content_items,automation_call_budgets,channels,credential_bindings,control_projects,control_approvals,workflow_jobs,workflow_submissions,artifacts,capability_executions,execution_evidence,amf_worker_presence RESTART IDENTITY CASCADE`);
  await pool.query(`DELETE FROM production_call_reservations WHERE project_id='morroway'`);
  const control = new ControlPlaneStore(pool); await control.registerProject({ projectId: "morroway", displayName: "Morroway", createdBy: "test", metadata: {} }); await migrate(pool);
  const now = new Date().toISOString();
  await pool.query(`INSERT INTO amf_worker_presence(worker_instance_id,build_id,runtime_mode,launcher,node_version,started_at,last_heartbeat_at,process_id,singleton_key,worker_role) VALUES('canary-phase-worker','fixture-build','PERSISTENT_PRODUCTION_WORKER','persistent-worker-script','test',$1,$1,$2,'amf-production-worker','canonical-production-queue-worker') ON CONFLICT(worker_instance_id) DO UPDATE SET last_heartbeat_at=$1,process_id=$2,singleton_key='amf-production-worker',worker_role='canonical-production-queue-worker',launcher='persistent-worker-script'`, [now, process.pid]);
  // Legacy Cycle-01 envelope in its real exhausted production shape.
  for (const [kind, limit, used] of [["research", 4, 4], ["text_agent", 10, 3], ["image_generation", 1, 0]])
    await pool.query(`INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at) VALUES('morroway',$1,$2,$3,0,$4,0,TRUE,$5) ON CONFLICT(project_id,phase,call_kind) DO UPDATE SET limit_count=EXCLUDED.limit_count,reserved_count=0,consumed_count=EXCLUDED.consumed_count,max_retries=0,active=TRUE,updated_at=EXCLUDED.updated_at`, [CYCLE_PHASE, kind, limit, used, now]);
  // Fresh isolated Golden Canary envelope.
  for (const [kind, limit] of [["research", 4], ["text_agent", 10], ["image_generation", 1], ["wan_generation", 1], ["public_publish", 0]])
    await pool.query(`INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at) VALUES('morroway',$1,$2,$3,0,0,0,TRUE,$4) ON CONFLICT(project_id,phase,call_kind) DO UPDATE SET limit_count=EXCLUDED.limit_count,reserved_count=0,consumed_count=0,max_retries=0,active=TRUE,updated_at=EXCLUDED.updated_at`, [CANARY_PHASE, kind, limit, now]);
  // Minimal PRE_MEDIA_PHASE rows for the legacy-fallback path.
  for (const [kind, limit] of [["research", 1], ["text_agent", 10]])
    await pool.query(`INSERT INTO production_phase_call_budgets(project_id,phase,call_kind,limit_count,reserved_count,consumed_count,max_retries,active,updated_at) VALUES('morroway','PRE_MEDIA_PHASE',$1,$2,0,0,0,TRUE,$3) ON CONFLICT(project_id,phase,call_kind) DO UPDATE SET limit_count=EXCLUDED.limit_count,reserved_count=0,consumed_count=0,max_retries=0,active=TRUE,updated_at=EXCLUDED.updated_at`, [kind, limit, now]);
  persistence = new PostgresPersistence(pool); queue = new PostgresQueue(pool);
  budgets = new ProductionCallBudgetStore(pool);
  const channels = new ChannelStore(pool); const automation = new AutomationStore(pool);
  const routing = { resolve: async (role) => ({ routingVersionId: "amf-balanced-production-routing-v1-morroway", profile: "BALANCED", role, slot: "primary", model: "fixture-model", priceSnapshotId: `price-${role}` }) };
  const handler = createWorkflowApiHandler({ persistence, queue, control, lifecycle: new LifecycleStore(pool), content: new ContentStore(pool), channels, automation, productionModelRouting: routing, productionCallBudgets: budgets });
  server = createServer((a, b) => void handler(a, b)); await new Promise((r) => server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  if (server) await new Promise((r) => server.close(r));
  if (pool) {
    if (createdIds.workflows.length) await pool.query(`DELETE FROM production_call_reservations WHERE workflow_id = ANY($1::text[])`, [createdIds.workflows]);
    if (createdIds.workflows.length) await pool.query(`DELETE FROM workflow_jobs WHERE workflow_id = ANY($1::text[])`, [createdIds.workflows]);
    if (createdIds.workflows.length) await pool.query(`DELETE FROM workflow_submissions WHERE workflow_id = ANY($1::text[])`, [createdIds.workflows]);
    if (createdIds.contents.length) await pool.query(`DELETE FROM content_items WHERE content_id = ANY($1::text[])`, [createdIds.contents]);
    await pool.query(`DELETE FROM production_phase_call_budgets WHERE project_id='morroway' AND phase=ANY($1::text[])`, [[CANARY_PHASE,SCOPED_CANARY_PHASE]]);
    await pool.query(`DELETE FROM owner_control_audit_events WHERE project_id='morroway' AND subject_id LIKE $1`, [`${SCOPED_CANARY_PHASE}%`]);
    await pool.query(`DELETE FROM amf_worker_presence WHERE worker_instance_id='canary-phase-worker'`);
    await pool.end();
  }
});
async function createContent(title, brief) {
  const created = await req("/control/content", { method: "POST", body: JSON.stringify({ projectId: "morroway", title, objective: brief.objective, topic: brief.topic, productionBrief: brief }) });
  assert.equal(created.status, 201);
  createdIds.contents.push(created.body.content.contentId);
  return created.body.content;
}

test("A. legacy Cycle-01 without explicit phase still resolves the old phase", async () => {
  const content = await createContent("canary-phase-A", briefFor());
  const pf = await req(`/control/content/${content.contentId}/preflight`);
  assert.equal(pf.status, 200);
  assert.equal(pf.body.preflight.budgetPhase, CYCLE_PHASE);
  assert.equal(pf.body.preflight.budgetPhaseExplicit, false);
  assert.equal(pf.body.preflight.budgetPhaseSource, "LEGACY_FALLBACK");
  assert.ok(pf.body.preflight.budgetErrors.includes("BUDGET_RESEARCH_EXHAUSTED"));
});

test("B+C+P. explicit Golden Canary phase resolves, preflight uses it and reports it", async () => {
  const content = await createContent("canary-phase-B", briefFor({ budgetPhase: CANARY_PHASE }));
  const pf = await req(`/control/content/${content.contentId}/preflight`);
  assert.equal(pf.status, 200);
  assert.equal(pf.body.preflight.ready, true);
  assert.equal(pf.body.preflight.budgetPhase, CANARY_PHASE);
  assert.equal(pf.body.preflight.budgetPhaseExplicit, true);
  assert.equal(pf.body.preflight.budgetPhaseSource, "EXPLICIT_AUTHORIZED");
  assert.deepEqual(pf.body.preflight.callEnvelope, { research: 4, text_agent: 10, image_generation: 1 });
  assert.ok(pf.body.preflight.budgets.every((b) => b.callKind !== undefined));
  const started = await req(`/control/content/${content.contentId}/start-production`, { method: "POST", body: "{}" });
  assert.equal(started.status, 201);
  assert.equal(started.body.budgetPhase, CANARY_PHASE);
  assert.equal(started.body.budgetPhaseExplicit, true);
  createdIds.workflows.push(started.body.workflowId);
  const sub = await queue.loadSubmissionByWorkflow(started.body.workflowId);
  assert.equal(sub.commandContext.budgetPhase, CANARY_PHASE);
  assert.equal(sub.commandContext.budgetPhaseExplicit, true);
  assert.equal(sub.commandContext.researchIntelligenceVersion, "V2");
});

test("canonical Golden Canary envelope builder produces a preflight-ready split authority matrix", async () => {
  await new OwnerAutonomyStore(pool).createGoldenCanaryBudgetEnvelope({projectId:"morroway",phase:SCOPED_CANARY_PHASE,actor:"owner-test",reason:"provider-free canonical envelope fixture"});
  const content=await createContent("canary-phase-scoped",briefFor({budgetPhase:SCOPED_CANARY_PHASE}));
  const pf=await req(`/control/content/${content.contentId}/preflight`);
  assert.equal(pf.status,200);
  assert.equal(pf.body.preflight.ready,true);
  assert.deepEqual(pf.body.preflight.callEnvelope,{research:4,research_text_agent:2,text_agent:8,image_generation:1});
  const started=await req(`/control/content/${content.contentId}/start-production`,{method:"POST",body:"{}"});
  assert.equal(started.status,201);
  createdIds.workflows.push(started.body.workflowId);
  const submission=await queue.loadSubmissionByWorkflow(started.body.workflowId);
  assert.equal(submission.commandContext.budgetPhase,SCOPED_CANARY_PHASE);
});

test("G. duplicate start-production reuses the same bound workflow", async () => {
  const content = await createContent("canary-phase-G", briefFor({ budgetPhase: CANARY_PHASE }));
  const first = await req(`/control/content/${content.contentId}/start-production`, { method: "POST", body: "{}" });
  assert.equal(first.status, 201);
  createdIds.workflows.push(first.body.workflowId);
  const second = await req(`/control/content/${content.contentId}/start-production`, { method: "POST", body: "{}" });
  assert.equal(second.status, 200);
  assert.equal(second.body.workflowId, first.body.workflowId);
  const n = await pool.query(`SELECT count(*)::int n FROM workflow_submissions WHERE submission_key=$1`, [`content-production:${content.contentId}`]);
  assert.equal(n.rows[0].n, 1);
  const sub = await queue.loadSubmissionByWorkflow(first.body.workflowId);
  assert.equal(sub.commandContext.budgetPhase, CANARY_PHASE);
});

test("H. unauthorized and malformed explicit phases fail closed", async () => {
  const badPhase = await createContent("canary-phase-H1", briefFor({ budgetPhase: "NOPE_NOT_AUTHORIZED" }));
  const pf = await req(`/control/content/${badPhase.contentId}/preflight`);
  assert.equal(pf.body.preflight.ready, false);
  assert.ok(pf.body.preflight.budgetErrors.includes("BUDGET_PHASE_UNAUTHORIZED"));
  const st = await req(`/control/content/${badPhase.contentId}/start-production`, { method: "POST", body: "{}" });
  assert.equal(st.status, 409);
  assert.equal(st.body.error, "BUDGET_PHASE_UNAUTHORIZED");
  const malformed = await createContent("canary-phase-H2", briefFor({ budgetPhase: "bad phase!" }));
  const pf2 = await req(`/control/content/${malformed.contentId}/preflight`);
  assert.ok(pf2.body.preflight.briefErrors.includes("BRIEF_BUDGET_PHASE_INVALID"));
  const upd = await req(`/control/content/${malformed.contentId}/brief`, { method: "POST", body: JSON.stringify({ brief: { budgetPhase: "bad phase!" } }) });
  assert.equal(upd.status, 400);
});

test("I. missing phase uses the documented legacy fallback only", async () => {
  const { productionCycle: _drop, budgetPhase: _drop2, ...legacy } = briefFor();
  const content = await createContent("canary-phase-I", legacy);
  const pf = await req(`/control/content/${content.contentId}/preflight`);
  assert.equal(pf.body.preflight.budgetPhase, "PRE_MEDIA_PHASE");
  assert.equal(pf.body.preflight.budgetPhaseSource, "LEGACY_FALLBACK");
});

test("D+E. worker reservation and reconciliation use and retain the canary phase", async () => {
  const r = await budgets.reserve({ projectId: "morroway", workflowId: "wf-canary-phase-de", phase: CANARY_PHASE, stage: "research", role: "research", callKind: "research", idempotencyKey: "canary-phase:de:1" });
  assert.equal(r.status, "RESERVED");
  createdIds.reservations.push(r.reservationId);
  await budgets.reconcile({ reservationId: r.reservationId, providerSubmissionStarted: true, success: true });
  const row = await pool.query(`SELECT phase,status FROM production_call_reservations WHERE reservation_id=$1`, [r.reservationId]);
  assert.equal(row.rows[0].phase, CANARY_PHASE);
  assert.equal(row.rows[0].status, "CONSUMED");
  const b = await pool.query(`SELECT consumed_count FROM production_phase_call_budgets WHERE project_id='morroway' AND phase=$1 AND call_kind='research'`, [CANARY_PHASE]);
  assert.equal(Number(b.rows[0].consumed_count), 1);
  await pool.query(`DELETE FROM production_call_reservations WHERE reservation_id=$1`, [r.reservationId]);
  await pool.query(`UPDATE production_phase_call_budgets SET consumed_count=0 WHERE project_id='morroway' AND phase=$1 AND call_kind='research'`, [CANARY_PHASE]);
});

test("G2. duplicate billable execution under the same idempotency key is blocked", async () => {
  const first = await budgets.reserve({ projectId: "morroway", workflowId: "wf-canary-phase-dup", phase: CANARY_PHASE, stage: "research", role: "research", callKind: "research", idempotencyKey: "canary-phase:dup:1" });
  assert.equal(first.status, "RESERVED");
  await budgets.reconcile({ reservationId: first.reservationId, providerSubmissionStarted: false, success: false });
  await assert.rejects(budgets.reserve({ projectId: "morroway", workflowId: "wf-canary-phase-dup", phase: CANARY_PHASE, stage: "research", role: "research", callKind: "research", idempotencyKey: "canary-phase:dup:1" }), /DUPLICATE_BILLABLE_EXECUTION_BLOCKED/);
  const row = await pool.query(`SELECT status FROM production_call_reservations WHERE reservation_id=$1`, [first.reservationId]);
  assert.equal(row.rows[0].status, "RELEASED_BEFORE_SUBMISSION");
  await pool.query(`DELETE FROM production_call_reservations WHERE reservation_id=$1`, [first.reservationId]);
});

test("J+K. exhausted old research does not block the canary and canary spend leaves old counters alone", async () => {
  const before = await pool.query(`SELECT call_kind,consumed_count FROM production_phase_call_budgets WHERE project_id='morroway' AND phase=$1 ORDER BY call_kind`, [CYCLE_PHASE]);
  assert.deepEqual(before.rows.map((r) => [r.call_kind, Number(r.consumed_count)]), [["image_generation", 0], ["research", 4], ["text_agent", 3]]);
  const content = await createContent("canary-phase-JK", briefFor({ budgetPhase: CANARY_PHASE }));
  const pf = await req(`/control/content/${content.contentId}/preflight`);
  assert.equal(pf.body.preflight.ready, true);
  const r = await budgets.reserve({ projectId: "morroway", workflowId: "wf-canary-phase-jk", phase: CANARY_PHASE, stage: "writer", role: "writer", callKind: "text_agent", idempotencyKey: "canary-phase:jk:1" });
  await budgets.reconcile({ reservationId: r.reservationId, providerSubmissionStarted: true, success: true });
  const after = await pool.query(`SELECT call_kind,consumed_count FROM production_phase_call_budgets WHERE project_id='morroway' AND phase=$1 ORDER BY call_kind`, [CYCLE_PHASE]);
  assert.deepEqual(after.rows.map((x) => [x.call_kind, Number(x.consumed_count)]), [["image_generation", 0], ["research", 4], ["text_agent", 3]]);
  await pool.query(`DELETE FROM production_call_reservations WHERE reservation_id=$1`, [r.reservationId]);
  await pool.query(`UPDATE production_phase_call_budgets SET consumed_count=0 WHERE project_id='morroway' AND phase=$1 AND call_kind='text_agent'`, [CANARY_PHASE]);
});

test("L+M. image_generation and wan_generation reserve under the same envelope", async () => {
  for (const [kind, key] of [["image_generation", "canary-phase:lm:img"], ["wan_generation", "canary-phase:lm:wan"]]) {
    const r = await budgets.reserve({ projectId: "morroway", workflowId: "wf-canary-phase-lm", phase: CANARY_PHASE, stage: "scene-image", role: "visual-director", callKind: kind, idempotencyKey: key });
    assert.equal(r.status, "RESERVED");
    await budgets.reconcile({ reservationId: r.reservationId, providerSubmissionStarted: false, success: false });
    await pool.query(`DELETE FROM production_call_reservations WHERE reservation_id=$1`, [r.reservationId]);
  }
});

test("N. public_publish remains zero and blocked", async () => {
  await assert.rejects(budgets.reserve({ projectId: "morroway", workflowId: "wf-canary-phase-n", phase: CANARY_PHASE, stage: "publisher", role: "publisher", callKind: "public_publish", idempotencyKey: "canary-phase:n:1" }), /PRODUCTION_PHASE_HARD_CAP_STOP/);
});

test("O. owner readiness resolves the same phase", async () => {
  const store = new OwnerAutonomyStore(pool);
  const onb = await store.onboarding("morroway");
  const canary = onb.budgetPhaseReadiness.find((r) => r.phase === CANARY_PHASE);
  assert.ok(canary);
  assert.equal(canary.ready, true);
  assert.deepEqual(canary.reasons, []);
  const old = onb.budgetPhaseReadiness.find((r) => r.phase === CYCLE_PHASE);
  assert.ok(old);
  assert.equal(old.ready, false);
});

test("Q. budgetPhase cannot change after binding", async () => {
  const content = await createContent("canary-phase-Q", briefFor({ budgetPhase: CANARY_PHASE }));
  const started = await req(`/control/content/${content.contentId}/start-production`, { method: "POST", body: "{}" });
  assert.equal(started.status, 201);
  createdIds.workflows.push(started.body.workflowId);
  const blocked = await req(`/control/content/${content.contentId}/brief`, { method: "POST", body: JSON.stringify({ brief: { budgetPhase: CYCLE_PHASE } }) });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "BUDGET_PHASE_IMMUTABLE_AFTER_BINDING");
  const same = await req(`/control/content/${content.contentId}/brief`, { method: "POST", body: JSON.stringify({ brief: { topic: "edited topic" } }) });
  assert.equal(same.status, 200);
  const sub = await queue.loadSubmissionByWorkflow(started.body.workflowId);
  assert.equal(sub.commandContext.budgetPhase, CANARY_PHASE);
});
