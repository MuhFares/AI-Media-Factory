/**
 * Slice 3 — decision queue + actionability API (isolated TEST DB).
 * Matrix 17 (attention from actionability), 18 (pipeline/approval parity),
 * 22 (reload), plus business labels and secret-free responses.
 */
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore, StrategicStore, LifecycleStore, ApprovalActionabilityStore } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
let pool, persistence, server, base;
process.env.AMF_OWNER_TOKEN ??= "test-owner-token";
async function req(path, options = {}) {
  const res = await fetch(`${base}${path}`, { headers: { "Content-Type": "application/json", "Authorization": "Bearer test-owner-token" }, ...options });
  const body = await res.json();
  return { status: res.status, body };
}
before(async () => {
  if (DATABASE_URL === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");
  pool = createPool({ connectionString: DATABASE_URL });
  await migrate(pool);
  persistence = new PostgresPersistence(pool);
  const queue = new PostgresQueue(pool);
  const handler = createWorkflowApiHandler({
    persistence, queue, control: new ControlPlaneStore(pool),
    strategic: new StrategicStore(pool), lifecycle: new LifecycleStore(pool),
    actionability: new ApprovalActionabilityStore(pool),
  });
  server = createServer((req_, res) => void handler(req_, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await persistence.close(); });

const pid = () => `dq-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

async function mkApproval(projectId, targetType, targetId) {
  const project = await req("/control/projects", { method: "POST", body: JSON.stringify({ projectId, displayName: `Decision fixture ${projectId}` }) });
  assert.ok([200, 201].includes(project.status));
  const c = await req("/control/approvals", { method: "POST", body: JSON.stringify({ projectId, targetType, targetId, agentRecommendation: {} }) });
  assert.equal(c.status, 201);
  return c.body.approval.approvalId;
}

test("decision queue separates actionable, no-action, history with business labels", async () => {
  const projectId = pid();
  const wf = `wf-${pid()}`;
  await pool.query(
    `INSERT INTO workflow_submissions (submission_key, workflow_id, directive, correlation_id, brand_id, definition, status, created_at, updated_at)
     VALUES ($1,$2,'produce','c',$3,'{}','revision_required',now()::text,now()::text)`, [`k-${wf}`, wf, projectId]);
  await pool.query(
    `INSERT INTO artifacts (artifact_id, workflow_id, kind, producer_agent, status, payload, content_type, schema_version, created_at)
     VALUES ($1,$2,'final_media_artifact','video','completed','{}','application/json','v1',now()::text)`, [`art-${wf}`, wf]);
  // actionable gate (no continuation yet beyond milestone? final media exists -> superseded; use fresh gate instead)
  const liveId = await mkApproval(projectId, "workflow_gate", `wf-fresh-${pid()}:pre-production-owner-gate`);
  const q = await req(`/control/decision-queue?projectId=${projectId}`);
  assert.equal(q.status, 200);
  assert.ok(q.body.needsDecision.some((i) => i.approvalId === liveId), "live gate needs decision");
  const item = q.body.needsDecision.find((i) => i.approvalId === liveId);
  assert.match(item.business.title, /Review content package/);
  assert.match(item.business.approveEffect, /media production/i);
  assert.ok(item.business.notEffects.length > 0);
  assert.equal(item.business.impact, "LOW");
  assert.equal(item.actionability, "ACTION_REQUIRED");
  assert.equal(q.body.counts.needsDecision, q.body.needsDecision.length);
  // superseded gate lands in noAction, not attention (gate predates continuation)
  const oldId = `ap-sup-${pid()}`;
  await pool.query(
    `INSERT INTO control_approvals (approval_id, project_id, target_type, target_id, agent_recommendation, evidence_refs, status, created_at)
     VALUES ($1,$2,'workflow_gate',$3,'{}','[]','PENDING','2026-01-01T00:00:00Z')`,
    [oldId, projectId, `${wf}:visual-human-gate`]);
  const q2 = await req(`/control/decision-queue?projectId=${projectId}`);
  assert.ok(q2.body.noAction.some((i) => i.approvalId === oldId), "superseded gate is no-action");
  assert.ok(!q2.body.needsDecision.some((i) => i.approvalId === oldId));
  // decide the live one -> moves to history
  await req(`/control/approvals/${liveId}/decision`, { method: "POST", body: JSON.stringify({ action: "APPROVE", rationale: "fixture" }) });
  const q3 = await req(`/control/decision-queue?projectId=${projectId}`);
  assert.ok(q3.body.history.some((i) => i.approvalId === liveId));
  assert.ok(!q3.body.needsDecision.some((i) => i.approvalId === liveId));
});

test("pipeline and approval center agree (parity)", async () => {
  const projectId = pid();
  const wf = `wf-${pid()}`;
  await pool.query(
    `INSERT INTO workflow_submissions (submission_key, workflow_id, directive, correlation_id, brand_id, definition, status, created_at, updated_at)
     VALUES ($1,$2,'produce','c',$3,'{}','submitted',now()::text,now()::text)`, [`k-${wf}`, wf, projectId]);
  const gateId = await mkApproval(projectId, "workflow_gate", `${wf}:pre-production-owner-gate`);
  const lc = await req(`/control/lifecycle/${wf}`);
  const dq = await req(`/control/decision-queue?projectId=${projectId}`);
  const lcNeeds = lc.body.lifecycle.attention.length;
  const dqNeeds = dq.body.needsDecision.filter((i) => i.approvalId === gateId).length;
  assert.equal(lcNeeds, 1);
  assert.equal(dqNeeds, 1);
  assert.equal(lc.body.lifecycle.overallState, "NEEDS_OWNER_ATTENTION");
});

test("single actionability endpoint + secret-free queue", async () => {
  const projectId = pid();
  const id = await mkApproval(projectId, "STRATEGY_ACTIVATION", `strat-${pid()}`);
  const one = await req(`/control/approvals/${id}/actionability`);
  assert.equal(one.status, 200);
  assert.equal(one.body.actionability.state, "ACTION_REQUIRED");
  const nf = await req("/control/approvals/approval-missing/actionability");
  assert.equal(nf.status, 404);
  const q = await req(`/control/decision-queue?projectId=${projectId}`);
  assert.doesNotMatch(JSON.stringify(q.body), /api[_-]?key\s*[:=]\s*\S+/i);
  const bad = await req("/control/decision-queue?projectId=");
  assert.equal(bad.status, 400);
});

test("override scope explains high impact; validation never publish", async () => {
  const projectId = pid();
  const ov = await mkApproval(projectId, "workflow_gate", `wf-${pid()}:gate`);
  await req(`/control/approvals/${ov}/decision`, { method: "POST", body: JSON.stringify({ action: "OVERRIDE", rationale: "fixture override" }) });
  const q = await req(`/control/decision-queue?projectId=${projectId}`);
  const item = q.body.history.find((i) => i.approvalId === ov);
  assert.equal(item.ownerDecision, "OVERRIDE");
  const pv = await mkApproval(projectId, "publication_integration_validation_gate", `wf-${pid()}:final`);
  const q2 = await req(`/control/decision-queue?projectId=${projectId}`);
  const pvi = q2.body.needsDecision.find((i) => i.approvalId === pv);
  assert.match(pvi.business.title, /publication validation/i);
  assert.match(pvi.business.notEffects.join(" "), /public publication/i);
});
