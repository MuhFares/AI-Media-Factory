/**
 * Program 5 multi-project isolation matrix (isolated TEST DB).
 * Two deterministic projects (morroway-seeded semantics + AMF Test Studio
 * fixture); every scoped query must not leak across. No provider calls.
 */
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import {
  createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore,
  ContentStore, SubjectStore, ChannelStore, LearningLoopStore, LifecycleStore,
  ApprovalActionabilityStore, StrategicStore,
} from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";

process.env.AMF_OWNER_TOKEN ??= "test-owner-token";
const AUTH = { Authorization: "Bearer test-owner-token" };
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
const A = "proj-alpha";
const B = "proj-beta";
let pool, server, base;
async function req(path, options = {}) {
  const res = await fetch(`${base}${path}`, { headers: { "Content-Type": "application/json", ...AUTH }, ...options });
  return { status: res.status, body: await res.json() };
}
async function post(path, body) {
  return req(path, { method: "POST", body: JSON.stringify(body) });
}
before(async () => {
  if (DATABASE_URL === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");
  pool = createPool({ connectionString: DATABASE_URL });
  await migrate(pool);
  await pool.query(`TRUNCATE control_projects, content_items, subject_profiles, subject_reference_assets, scene_specs, strategic_entities, strategic_activations, strategic_context_snapshots, strategic_iterations, workflow_submissions, workflow_jobs, artifacts, capability_executions, execution_provenance, control_approvals, control_commands, control_configuration_events, performance_observations, learning_records, next_cycle_recommendations, next_cycle_proposals, channels, credential_bindings RESTART IDENTITY CASCADE`);
  const handler = createWorkflowApiHandler({
    persistence: new PostgresPersistence(pool),
    queue: new PostgresQueue(pool),
    control: new ControlPlaneStore(pool),
    strategic: new StrategicStore(pool),
    lifecycle: new LifecycleStore(pool),
    actionability: new ApprovalActionabilityStore(pool),
    content: new ContentStore(pool),
    subjects: new SubjectStore(pool),
    channels: new ChannelStore(pool),
    learning: new LearningLoopStore(pool),
  });
  server = createServer((req_, res) => void handler(req_, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await pool.end(); });

test("project creation validates identity; Morroway-style seed intact", async () => {
  const bad = await post("/control/projects", { projectId: "bad id!", displayName: "x" });
  assert.equal(bad.status, 400);
  for (const pid of [A, B]) {
    const created = await post("/control/projects", { projectId: pid, displayName: pid === A ? "Alpha Studio" : "Beta Studio" });
    assert.ok([200, 201].includes(created.status));
    assert.equal(created.body.project.projectId, pid);
  }
  const dup = await post("/control/projects", { projectId: A, displayName: "Again" });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.created, false);
  const list = await req("/control/projects");
  assert.ok(list.body.projects.some((p) => p.projectId === A));
  assert.ok(list.body.projects.some((p) => p.projectId === B));
});

test("A/B/C: content, subjects, strategy isolated by project", async () => {
  const mk = async (pid, title) => (await post("/control/content", { projectId: pid, title, objective: "o" })).body.content;
  const a1 = await mk(A, "Alpha One");
  await mk(B, "Beta One");
  const la = await req(`/control/content?projectId=${A}`);
  assert.deepEqual(la.body.contents.map((c) => c.contentId), [a1.contentId]);
  const sa = await post("/control/subjects", { projectId: A, name: "Host", description: "d" });
  await post("/control/subjects", { projectId: B, name: "Host", description: "d" });
  const sla = await req(`/control/subjects?projectId=${A}`);
  assert.equal(sla.body.subjects.length, 1);
  assert.equal(sla.body.subjects[0].subjectId, sa.body.subject.subjectId);
  const strat = new StrategicStore(pool);
  await strat.propose({ projectId: A, entityType: "BRAND", payload: { brand: "Alpha" }, sourceArtifactIds: [], createdBy: "owner" });
  const entA = await req(`/control/strategy/entities?projectId=${A}`);
  const entB = await req(`/control/strategy/entities?projectId=${B}`);
  assert.equal(entA.status, 200);
  assert.equal((entA.body.entities || []).length, 1);
  assert.deepEqual(entB.body.entities, []);
});

test("D/E/F: artifacts, analytics, learning scoped per project", async () => {
  const sub = await post("/workflows", { directive: "produce", correlationId: "mp-1", brandId: A, idempotencyKey: "mp-idem-1" });
  assert.equal(sub.status, 201, JSON.stringify(sub.body));
  const wf = sub.body.workflowId;
  const artsA = await req(`/control/artifacts?projectId=${A}`);
  assert.ok(Array.isArray(artsA.body.artifacts));
  const artsB = await req(`/control/artifacts?projectId=${B}`);
  assert.equal(artsB.body.artifacts.length, 0);
  const cross = await req(`/control/artifacts?projectId=${B}&workflowId=${wf}`);
  assert.equal(cross.status, 403);
  const same = await req(`/control/artifacts?projectId=${A}&workflowId=${wf}`);
  assert.equal(same.status, 200);
  const costsA = await req(`/control/costs?projectId=${A}`);
  const costsB = await req(`/control/costs?projectId=${B}`);
  assert.deepEqual([costsA.status, costsB.status], [200, 200]);
  const tel = await req(`/control/telemetry?projectId=${B}`);
  assert.equal((tel.body.telemetry || []).length, 0);
});

test("G/H/I: channels bound per project; cross-project use blocked", async () => {
  const unsup = await post("/control/channels", { projectId: A, platform: "tiktok", displayName: "T" });
  assert.equal(unsup.status, 400);
  const chA = (await post("/control/channels", { projectId: A, platform: "youtube", displayName: "Alpha Main" })).body.channel;
  await post("/control/channels", { projectId: B, platform: "youtube", displayName: "Beta Main" });
  const listA = await req(`/control/channels?projectId=${A}`);
  assert.deepEqual(listA.body.channels.map((c) => c.channelId), [chA.channelId]);
  const bindA = (await post(`/control/channels/${chA.channelId}/bindings`, { projectId: A, provider: "youtube", credentialRef: "owner-youtube-a" })).body.binding;
  const route = await req(`/control/publishing/route?projectId=${A}&channelId=${chA.channelId}&bindingId=${bindA.bindingId}&visibility=private`);
  assert.equal(route.status, 409, "unverified channel fails closed");
  const verified = await post(`/control/channels/${chA.channelId}/verify`, { externalChannelId: "UCaaaaaaaaaaaaaaaaaaaaaa", handle: "@alpha", rationale: "studio check" });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.channel.status, "VERIFIED");
  const route2 = await req(`/control/publishing/route?projectId=${A}&channelId=${chA.channelId}&bindingId=${bindA.bindingId}&visibility=private`);
  assert.equal(route2.status, 200);
  assert.equal(route2.body.routable, true);
  assert.equal(route2.body.route.externalChannelId, "UCaaaaaaaaaaaaaaaaaaaaaa");
  const cross = await req(`/control/publishing/route?projectId=${B}&channelId=${chA.channelId}&bindingId=${bindA.bindingId}&visibility=private`);
  assert.equal(cross.status, 409);
  const pub = await req(`/control/publishing/route?projectId=${A}&channelId=${chA.channelId}&bindingId=${bindA.bindingId}&visibility=public`);
  assert.equal(pub.status, 200, "visibility itself is platform-allowed; authorization stays separate");
  const revoked = await post(`/control/bindings/${bindA.bindingId}/revoke`, {});
  assert.equal(revoked.body.binding.status, "REVOKED");
  const afterRevoke = await req(`/control/publishing/route?projectId=${A}&channelId=${chA.channelId}&bindingId=${bindA.bindingId}&visibility=private`);
  assert.equal(afterRevoke.status, 409);
});

test("J/K/L: switching changes context only; portfolio aggregates intentionally", async () => {
  const pa = await req(`/control/content?projectId=${A}`);
  const pb = await req(`/control/content?projectId=${B}`);
  assert.ok(pa.body.contents.length >= 1 && pb.body.contents.length >= 1);
  assert.ok(!pa.body.contents.some((c) => pb.body.contents.map((x) => x.contentId).includes(c.contentId)));
  const portfolio = await req("/control/projects");
  const ids = portfolio.body.projects.map((p) => p.projectId);
  assert.ok(ids.includes(A) && ids.includes(B), "portfolio intentionally sees both");
  const sys = await req("/control/health");
  assert.equal(sys.status, 200);
});

test("H/X: approvals scoped per project; decisions do not leak", async () => {
  const mk = async (pid) => (await post("/control/approvals", {
    projectId: pid, targetType: "artifact", targetId: `art-${pid}-1`, agentRecommendation: { ok: true },
  })).body.approval;
  const aa = await mk(A);
  await mk(B);
  const dqA = await req(`/control/decision-queue?projectId=${A}`);
  assert.ok(dqA.body.needsDecision.some((x) => x.approvalId === aa.approvalId));
  assert.ok(!dqA.body.needsDecision.some((x) => x.projectId === B));
  const decided = await post(`/control/approvals/${aa.approvalId}/decision`, { action: "APPROVE", rationale: "alpha only" });
  assert.equal(decided.status, 200);
  const dqB = await req(`/control/decision-queue?projectId=${B}`);
  assert.equal(dqB.body.counts.needsDecision, 1, "B still has exactly its own decision");
});

test("brandId required on workflow submission (no projectless execution)", async () => {
  const r = await post("/workflows", { directive: "research", correlationId: "mp-nb" });
  assert.equal(r.status, 400);
});
