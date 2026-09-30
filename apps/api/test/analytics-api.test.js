/**
 * Program 4 analytics API (isolated TEST DB): domain endpoints over
 * deterministic fixtures. No provider calls; STUBBED fixtures labeled.
 */
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import {
  createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore,
  ContentStore, LearningLoopStore,
} from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";

process.env.AMF_OWNER_TOKEN ??= "test-owner-token";
const AUTH = { Authorization: "Bearer test-owner-token" };
const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
const PID = `an-${Date.now().toString(36)}`;
let pool, server, base, cA, cB;
async function req(path, options = {}) {
  const res = await fetch(`${base}${path}`, { headers: { "Content-Type": "application/json", ...AUTH }, ...options });
  return { status: res.status, body: await res.json() };
}
before(async () => {
  if (DATABASE_URL === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");
  pool = createPool({ connectionString: DATABASE_URL });
  await migrate(pool);
  const content = new ContentStore(pool);
  const learning = new LearningLoopStore(pool);
  cA = await content.createContent({ projectId: `${PID}-proj`, title: "Alpha", objective: "oa" });
  cB = await content.createContent({ projectId: `${PID}-proj`, title: "Beta", objective: "ob" });
  const mkObs = async (wf, metrics) => learning.recordObservation({
    projectId: `${PID}-proj`, workflowId: wf, artifactId: null,
    lineageKind: "VALIDATION_FIXTURE", windowStart: "2026-09-01T00:00:00.000Z",
    windowEnd: "2026-09-02T00:00:00.000Z", metrics,
    metricProvenance: "STUBBED", transportProvenance: "STUBBED",
  });
  await content.linkRecords(cA.contentId, { workflowId: `wf-${PID}-a` });
  await content.linkRecords(cB.contentId, { workflowId: `wf-${PID}-b` });
  const oA = await mkObs(`wf-${PID}-a`, { views: 100, likes: 4, comments: 1, shares: 1 });
  await mkObs(`wf-${PID}-b`, { views: 50, likes: 1, comments: 0, shares: 0 });
  const learned = await learning.recordLearning({
    projectId: `${PID}-proj`, observationIds: [oA.observation.observationId],
    finding: "alpha leads on stubbed views",
    evidence: { observationId: oA.observation.observationId },
  });
  globalThis.__learned = learned.learning;
  const handler = createWorkflowApiHandler({
    persistence: new PostgresPersistence(pool),
    queue: new PostgresQueue(pool),
    control: new ControlPlaneStore(pool),
    content, learning,
  });
  server = createServer((req_, res) => void handler(req_, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await pool.end(); });

test("overview, content list, and availability stay honest on thin data", async () => {
  const over = await req(`/control/analytics/overview?projectId=${PID}-proj`);
  assert.equal(over.status, 200);
  assert.equal(over.body.contents, 2);
  assert.equal(over.body.measured, 2);
  assert.equal(over.body.learnings, 1);
  const list = await req(`/control/analytics/content?projectId=${PID}-proj`);
  assert.equal(list.status, 200);
  const alpha = list.body.contents.find((c) => c.contentId === cA.contentId);
  assert.equal(alpha.measurementState, "AVAILABLE");
  assert.equal(alpha.metrics.views, 100);
  const eng = alpha.kpis.find((k) => k.name === "engagementRate");
  assert.equal(eng.state, "OK");
  assert.equal(eng.value, 0.06);
  const avail = await req(`/control/analytics/availability?projectId=${PID}-proj`);
  assert.ok(avail.body.contents.every((c) => c.state === "AVAILABLE"));
  assert.ok(avail.body.metricCatalog.metrics.some((m) => m.name === "views"));
});

test("comparisons explain quality; experiments track evaluability", async () => {
  const cmp = await req(`/control/analytics/comparisons?projectId=${PID}-proj&a=${cA.contentId}&b=${cB.contentId}&metric=views`);
  assert.equal(cmp.status, 200);
  assert.equal(cmp.body.quality, "COMPARABLE");
  assert.equal(cmp.body.leader, "A");
  assert.equal(cmp.body.delta, -50);
  assert.ok(cmp.body.insight.text.includes("Alpha"));
  const badMetric = await req(`/control/analytics/comparisons?projectId=${PID}-proj&a=${cA.contentId}&b=${cB.contentId}&metric=bogus`);
  assert.equal(badMetric.body.quality, "NOT_APPLICABLE");
  const exps = await req(`/control/analytics/experiments?projectId=${PID}-proj`);
  assert.ok(Array.isArray(exps.body.experiments));
  const insights = await req(`/control/analytics/insights?projectId=${PID}-proj`);
  assert.ok(insights.body.insights.length > 0);
  assert.ok(insights.body.insights.every((i) => Array.isArray(i.evidenceRefs)));
});

test("detail, agent queries, and learning reuse", async () => {
  const detail = await req(`/control/analytics/content/${cA.contentId}?projectId=${PID}-proj`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.content.contentId, cA.contentId);
  assert.ok(Array.isArray(detail.body.kpis));
  const missing = await req(`/control/analytics/content/nope?projectId=${PID}-proj`);
  assert.equal(missing.status, 404);
  const best = await req(`/control/analytics/agent-query?projectId=${PID}-proj&question=${encodeURIComponent("What performed best?")}`);
  assert.equal(best.body.answer, "best_by_views");
  assert.equal(best.body.evidence.contentId, cA.contentId);
  assert.equal(best.body.evidenceQuality, "COMPARABLE");
  const req2 = await req(`/control/analytics/agent-query?projectId=${PID}-proj&question=${encodeURIComponent("Compare Shorts and long-form")}`);
  assert.equal(req2.body.evidenceQuality, "INSUFFICIENT_DATA");
});
