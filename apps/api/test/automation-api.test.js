/**
 * Program 6 — Governed Automation API contract (isolated TEST DB).
 * Proves the Node control-plane surface: policy, jobs, explain/tick,
 * starter, budgets, attention, observability, project isolation, and that
 * existing control routes keep working with automation wired in.
 * No provider calls, no publications, no live analytics.
 */
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import {
  createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore,
  ContentStore, SubjectStore, ChannelStore, LearningLoopStore, LifecycleStore,
  ApprovalActionabilityStore, StrategicStore, AutomationStore,
} from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";

process.env.AMF_OWNER_TOKEN ??= "test-owner-token";
const AUTH = { Authorization: "Bearer test-owner-token" };
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
const RID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const A = `autoapi-a-${RID}`;
const B = `autoapi-b-${RID}`;
let pool, server, base;

async function req(path, options = {}) {
  const res = await fetch(`${base}${path}`, { headers: { "Content-Type": "application/json", ...AUTH }, ...options });
  return { status: res.status, body: await res.json() };
}
async function post(path, body, auth = AUTH) {
  const res = await fetch(`${base}${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function get(path) {
  return req(path);
}

before(async () => {
  if (DATABASE_URL === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");
  pool = createPool({ connectionString: DATABASE_URL });
  await migrate(pool);
  const control = new ControlPlaneStore(pool);
  await control.registerProject({ projectId: A, displayName: "Auto API A" });
  await control.registerProject({ projectId: B, displayName: "Auto API B" });
  const handler = createWorkflowApiHandler({
    persistence: new PostgresPersistence(pool),
    queue: new PostgresQueue(pool),
    control,
    strategic: new StrategicStore(pool),
    lifecycle: new LifecycleStore(pool),
    actionability: new ApprovalActionabilityStore(pool),
    content: new ContentStore(pool),
    subjects: new SubjectStore(pool),
    channels: new ChannelStore(pool),
    learning: new LearningLoopStore(pool),
    automation: new AutomationStore(pool),
  });
  server = createServer((req_, res) => void handler(req_, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await pool.end(); });

test("policy defaults fail closed; Owner can configure L2", async () => {
  const d = await get(`/control/automation/policy?projectId=${A}`);
  assert.equal(d.status, 200);
  assert.equal(d.body.policy.enabled, false);
  assert.equal(d.body.policy.level, "L0_MANUAL");
  assert.equal(d.body.policy.nextCyclePolicy, "OWNER_START_ONLY");
  const s = await post(`/control/automation/policy`, {
    projectId: A, enabled: true, level: "L2_GOVERNED",
    allowedOps: ["internal.prepare", "internal.plan", "workflow.resume", "nextcycle.evaluate", "nextcycle.start.internal"],
    humanGatedOps: [], providerPolicy: { mode: "DENY_ALL" },
    publicationPolicy: "PREPARE_ONLY", nextCyclePolicy: "OWNER_START_ONLY",
  });
  assert.equal(s.status, 200);
  assert.equal(s.body.policy.enabled, true);
  const bad = await post(`/control/automation/policy`, { projectId: A, enabled: true, level: "L3_HIGH_AUTONOMY" });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /DEFERRED/);
});

test("jobs schedule idempotently; explain dry-runs; tick executes bounded internal work", async () => {
  const s1 = await post(`/control/automation/jobs`, { projectId: A, jobType: "eligible_work_evaluation", payload: {}, idempotencyKey: `api-job-${RID}` });
  assert.equal(s1.status, 200);
  assert.equal(s1.body.created, true);
  const s2 = await post(`/control/automation/jobs`, { projectId: A, jobType: "eligible_work_evaluation", payload: {}, idempotencyKey: `api-job-${RID}` });
  assert.equal(s2.body.created, false);
  assert.equal(s2.body.job.jobId, s1.body.job.jobId);
  const ex = await post(`/control/automation/explain`, { projectId: A });
  assert.equal(ex.status, 200);
  assert.equal(ex.body.executed, false);
  assert.ok(ex.body.eligible.length >= 1);
  const t = await post(`/control/automation/tick`, { projectId: A, maxActions: 5 });
  assert.equal(t.status, 200);
  assert.ok(t.body.acted >= 1);
  assert.equal(t.body.completedTick, true);
  const jobs = await get(`/control/automation/jobs?projectId=${A}`);
  assert.ok(jobs.body.jobs.some((j) => j.state === "SUCCEEDED"));
});

test("governed starter stops at Owner boundary under OWNER_START_ONLY", async () => {
  // Build a proposal chain directly in canonical tables (no automation).
  const learning = new LearningLoopStore(pool);
  const obs = await learning.recordObservation({
    projectId: A, workflowId: `wf-api-${RID}`, lineageKind: "VALIDATION_FIXTURE",
    metrics: { views: 100 }, metricProvenance: "STUBBED", transportProvenance: "STUBBED",
  });
  const lr = await learning.recordLearning({ projectId: A, observationIds: [obs.observation.observationId], finding: "api fixture", evidence: {} });
  const rc = await learning.recommend({ projectId: A, learningId: lr.learning.learningId, proposal: "p", rationale: "r", evidence: {} });
  const pc = await learning.proposeNextCycle({ projectId: A, recommendationId: rc.recommendation.recommendationId, summary: "api cycle" });
  const ev = await get(`/control/automation/proposals/${pc.proposal.proposalId}/evaluate`);
  assert.equal(ev.status, 200);
  assert.equal(ev.body.eligibleToStart, false);
  const st = await post(`/control/automation/proposals/${pc.proposal.proposalId}/start`, { actor: "api-test" });
  assert.equal(st.status, 200);
  assert.equal(st.body.started, false);
  const att = await get(`/control/automation/attention?projectId=${A}`);
  assert.ok(att.body.attention.some((a) => a.kind === "READY_FOR_OWNER_START"));
});

test("budgets gate provider work; measurement scheduling enforces channel scope", async () => {
  const b = await post(`/control/automation/budgets`, { projectId: A, callKind: "analytics", limitCount: 3 });
  assert.equal(b.status, 200);
  assert.equal(b.body.budget.limit, 3);
  const bg = await get(`/control/automation/budgets?projectId=${A}`);
  assert.ok(bg.body.budgets.some((x) => x.callKind === "analytics"));
  // Unknown channel fails closed.
  const m1 = await post(`/control/automation/analytics/measurements`, { projectId: A, channelId: "channel-does-not-exist", idempotencyKey: `api-m-${RID}` });
  assert.equal(m1.status, 400);
  // Cross-project channel fails closed.
  const channels = new ChannelStore(pool);
  const ch = await channels.createChannel({ projectId: B, platform: "youtube", displayName: "api foreign" });
  const m2 = await post(`/control/automation/analytics/measurements`, { projectId: A, channelId: ch.channelId, idempotencyKey: `api-m2-${RID}` });
  assert.equal(m2.status, 400);
  assert.match(m2.body.error, /CROSS_PROJECT/);
});

test("project isolation: B sees none of A's automation state", async () => {
  const ja = await get(`/control/automation/jobs?projectId=${A}`);
  const jb = await get(`/control/automation/jobs?projectId=${B}`);
  assert.ok(ja.body.jobs.length >= 1);
  assert.equal(jb.body.jobs.length, 0);
  const ea = await get(`/control/automation/events?projectId=${A}`);
  const eb = await get(`/control/automation/events?projectId=${B}`);
  assert.ok(ea.body.events.length >= 1);
  assert.equal(eb.body.events.length, 0);
  const ov = await get(`/control/automation/overview`);
  assert.equal(ov.status, 200);
  assert.ok(ov.body.projects.some((p) => p.projectId === A));
});

test("attention resolves explicitly; status reflects state", async () => {
  const att = await get(`/control/automation/attention?projectId=${A}`);
  const open = att.body.attention.find((a) => a.status === "OPEN");
  assert.ok(open, "expected an open attention item");
  const r = await post(`/control/automation/attention/${open.attentionId}/resolve`, { projectId: A });
  assert.equal(r.status, 200);
  assert.equal(r.body.attention.status, "RESOLVED");
  const st = await get(`/control/automation/status?projectId=${A}`);
  assert.equal(st.status, 200);
  assert.equal(st.body.projectId, A);
  assert.ok(st.body.state);
});

test("mutations require Owner auth; existing control routes unaffected", async () => {
  const anon = await post(`/control/automation/tick`, { projectId: A }, {});
  assert.ok([401, 503].includes(anon.status), `expected auth denial, got ${anon.status}`);
  const projects = await get(`/control/projects`);
  assert.equal(projects.status, 200);
  assert.ok(projects.body.projects.some((p) => p.projectId === A));
  const approvals = await get(`/control/approvals?projectId=${A}`);
  assert.equal(approvals.status, 200);
});
