/**
 * E2E Operating Loop Proof M2 — governed learning loop (isolated TEST DB).
 * STUBBED analytics → observation → lineage → experiment → evaluation →
 * learning → recommendation → proposal → Owner boundary. STOP there.
 * Hard limits: 0 live provider calls, 0 LLM, 0 video, 0 publish,
 * 0 live analytics. Stubbed reads reuse the frozen mock only.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { YouTubeAnalyticsAdapter } from "@ai-media-factory/provider-adapters";
import { createAnalyticsMock } from "../../provider-adapters/test/helpers/mock-servers.ts";
import {
  createPool, migrate, PostgresQueue, ControlPlaneStore, LifecycleStore,
  LearningLoopStore, evaluateGate, ApprovalActionabilityStore,
} from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();
if (!process.env.TEST_DATABASE_URL) throw new Error("M2 requires isolated TEST_DATABASE_URL");

const PID = `m2-${Date.now().toString(36)}`;
const PROJ = `${PID}-proj`;
const WF = `wf-${PID}`;
const ART = `art-${PID}-final`;
const EXP = `exp-${PID}-pilot-gates`;
// Fixture gate specs mirror the known Morroway hypothesis VALUES for shape
// only. They are test-local constants — never canonical KPIs, never authority.
const GATES = [
  { id: "engagement", metric: "engagement_rate", comparator: ">=", threshold: 0.05, windowDays: 7 },
  { id: "views", metric: "views", comparator: ">=", threshold: 10000, windowDays: 7 },
  { id: "growth", metric: "follower_growth_rate", comparator: ">=", threshold: 0.10, windowDays: 7 },
  { id: "revenue", metric: "revenue", comparator: ">=", threshold: 100, windowDays: 7 },
];
let pool, queue, control, lifecycle, store, actionability, mock;
let stubReads = 0;
const window = { windowStart: "2026-09-01T00:00:00.000Z", windowEnd: "2026-09-15T00:00:00.000Z" };

before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  queue = new PostgresQueue(pool);
  control = new ControlPlaneStore(pool);
  lifecycle = new LifecycleStore(pool);
  store = new LearningLoopStore(pool);
  actionability = new ApprovalActionabilityStore(pool);
  mock = await createAnalyticsMock();
  await queue.submit({
    submissionKey: `${PID}-sub`, workflowId: WF, directive: "produce",
    correlationId: `${PID}-corr`, brandId: PROJ, definition: { stages: [] }, status: "submitted",
  });
  await pool.query(
    `INSERT INTO artifacts (artifact_id,workflow_id,kind,producer_agent,status,payload,content_type,schema_version,created_at)
     VALUES ($1,$2,'final_media_artifact','validation-harness','completed','{}','application/json','test-v1',$3)`,
    [ART, WF, new Date().toISOString()],
  );
});
after(async () => { try { await mock.close(); } catch {} await pool.end(); });

async function stubMetrics(publicationId) {
  assert.ok(stubReads < 10, "M2 proof uses stubbed reads only");
  const adapter = new YouTubeAnalyticsAdapter({ accessToken: "m2-stub", baseUrl: mock.url, windowDays: 30 });
  const r = await adapter.fetch({ publicationId, platform: "youtube" });
  stubReads += 1;
  return r.metrics;
}
function obsInput(metrics, over = {}) {
  return {
    projectId: PROJ, workflowId: WF, artifactId: ART, experimentId: EXP,
    lineageKind: "VALIDATION_FIXTURE", transportProvenance: "STUBBED", metricProvenance: "STUBBED",
    observedAt: "2026-09-16T00:00:00.000Z", metrics, ...window, ...over,
  };
}
async function learnFrom(obsId, finding) {
  return store.recordLearning({
    projectId: PROJ, observationIds: [obsId], experimentId: EXP,
    finding, evidence: { observationId: obsId, gates: GATES.map((g) => g.id) },
  });
}
async function recommendFor(learningId, proposal) {
  return store.recommend({
    projectId: PROJ, learningId, proposal, rationale: `evidence-linked: ${learningId}`,
    evidence: { learningId },
  });
}

test("CASE A: valid metric, gate MET → learning → recommendation → proposal", async () => {
  const m = await stubMetrics("vid-1");
  const { observation } = await store.recordObservation(obsInput({
    engagement_rate: 0.06, views: m.views, follower_growth_rate: 0.02, revenue: m.revenue,
  }));
  assert.equal(observation.lineageKind, "VALIDATION_FIXTURE");
  assert.equal(observation.workflowId, WF);
  assert.equal(observation.artifactId, ART);
  assert.equal(observation.experimentId, EXP);
  const evals = GATES.map((g) => evaluateGate(observation, g));
  assert.equal(evals.find((e) => e.gateId === "engagement").verdict, "MET");
  const { learning } = await learnFrom(observation.observationId, "engagement hypothesis met on validation fixture");
  assert.equal(learning.validationOnly, true, "STUBBED-derived learning stays validation-only");
  const { recommendation } = await recommendFor(learning.learningId, "hold format; retest engagement on next item");
  assert.equal(recommendation.requiresOwnerDecision, true);
  assert.deepEqual(recommendation.evidence.learningId, learning.learningId);
  const { proposal } = await store.proposeNextCycle({
    projectId: PROJ, recommendationId: recommendation.recommendationId, summary: "next governed item under same gates",
  });
  assert.equal(proposal.status, "AWAITS_OWNER_DECISION");
  assert.equal(proposal.approvalId, null);
});

test("CASE B: valid metric, gate NOT_MET → learning → recommendation → proposal", async () => {
  const { observation } = await store.recordObservation(obsInput({
    engagement_rate: 0.02, views: 4000, follower_growth_rate: 0.01, revenue: 9.5,
  }));
  const evals = GATES.map((g) => evaluateGate(observation, g));
  assert.equal(evals.find((e) => e.gateId === "engagement").verdict, "NOT_MET");
  assert.equal(evals.find((e) => e.gateId === "revenue").verdict, "NOT_MET");
  const { learning } = await learnFrom(observation.observationId, "engagement hypothesis not met on validation fixture");
  const { recommendation } = await recommendFor(learning.learningId, "vary hook; keep pillars");
  const { proposal } = await store.proposeNextCycle({
    projectId: PROJ, recommendationId: recommendation.recommendationId, summary: "varied-hook next item",
  });
  assert.equal(proposal.status, "AWAITS_OWNER_DECISION");
});

test("CASE C+D: missing metric and incomplete window fail closed, never zero", async () => {
  const { observation: missing } = await store.recordObservation(obsInput({ views: 12000 }));
  const r1 = evaluateGate(missing, GATES[0]);
  assert.equal(r1.verdict, "INSUFFICIENT_DATA");
  assert.match(r1.detail, /missing/);
  const { observation: short } = await store.recordObservation(obsInput(
    { engagement_rate: 0.09 },
    { windowStart: "2026-09-14T00:00:00.000Z", windowEnd: "2026-09-15T00:00:00.000Z" },
  ));
  assert.equal(evaluateGate(short, GATES[0]).verdict, "INSUFFICIENT_DATA");
  const nan = await store.recordObservation(obsInput({ engagement_rate: "high" }));
  assert.equal(evaluateGate(nan.observation, GATES[0]).verdict, "INSUFFICIENT_DATA");
});

test("CASE E: stub provenance stays validation-only, never LIVE evidence", async () => {
  const { observation } = await store.recordObservation(obsInput({ engagement_rate: 0.07 }));
  assert.equal(observation.transportProvenance, "STUBBED");
  const { learning } = await learnFrom(observation.observationId, "stubbed finding");
  assert.equal(learning.validationOnly, true);
  const liveGated = evaluateGate(observation, { ...GATES[0], requiresLive: true });
  assert.equal(liveGated.verdict, "INSUFFICIENT_DATA");
  const dump = JSON.stringify({ observation, learning });
  assert.ok(!/LIVE_BUSINESS_EVIDENCE|live-provider success/i.test(dump));
});

test("CASE F: duplicate ingestion is idempotent across the whole chain", async () => {
  const input = obsInput({ engagement_rate: 0.08, views: 11000 });
  const first = await store.recordObservation(input);
  assert.equal(first.created, true);
  const second = await store.recordObservation(input);
  assert.equal(second.created, false);
  assert.equal(second.observation.observationId, first.observation.observationId);
  const l1 = await learnFrom(first.observation.observationId, "dup finding");
  const l2 = await learnFrom(first.observation.observationId, "dup finding");
  assert.equal(l2.created, false);
  const r1 = await recommendFor(l1.learning.learningId, "dup proposal");
  const r2 = await recommendFor(l1.learning.learningId, "dup proposal");
  assert.equal(r1.recommendation.rationale, r2.recommendation.rationale);
  const before = await pool.query(`SELECT count(*)::int AS n FROM next_cycle_proposals WHERE project_id=$1`, [PROJ]);
  const p1 = await store.proposeNextCycle({ projectId: PROJ, recommendationId: r1.recommendation.recommendationId, summary: "dup summary" });
  const p2 = await store.proposeNextCycle({ projectId: PROJ, recommendationId: r1.recommendation.recommendationId, summary: "dup summary" });
  assert.equal(p2.created, false);
  assert.equal(p1.proposal.proposalId, p2.proposal.proposalId);
  const after = await pool.query(`SELECT count(*)::int AS n FROM next_cycle_proposals WHERE project_id=$1`, [PROJ]);
  assert.equal(Number(after.rows[0].n), Number(before.rows[0].n) + 1, "exactly one canonical proposal");
});

test("CASE G+H+I: recommendation cannot start work; proposal routes to canonical Owner boundary; absent decision means NOT_STARTED", async () => {
  const { observation } = await store.recordObservation(obsInput({ engagement_rate: 0.06 }));
  const { learning } = await learnFrom(observation.observationId, "g-case finding");
  const { recommendation } = await recommendFor(learning.learningId, "proceed to governed next item");
  const { proposal } = await store.proposeNextCycle({
    projectId: PROJ, recommendationId: recommendation.recommendationId, summary: "g-case next item",
  });
  // G: preparing the proposal submitted nothing executable.
  const subs = await pool.query(`SELECT count(*)::int AS n FROM workflow_submissions WHERE workflow_id=$1`, [`wf-${proposal.proposalId}`]);
  assert.equal(Number(subs.rows[0].n), 0);
  // H: route to the canonical Owner decision boundary (isolated TEST DB only).
  const ap = await control.createApproval({
    approvalId: `${PID}-ncp`, projectId: PROJ, targetType: "NEXT_CYCLE_PROPOSAL",
    targetId: `m2-next-cycle-proposal-${proposal.proposalId}`,
    agentRecommendation: { proposalId: proposal.proposalId, summary: proposal.summary },
    agentConfidence: null, evidenceRefs: [learning.learningId], status: "AWAITING_OWNER",
    supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
  });
  const classified = await actionability.approvalActionability(ap.approvalId);
  assert.equal(classified.state, "ACTION_REQUIRED", "canonical classifier routes the proposal, no second system");
  // I: decision absent → next cycle NOT_STARTED.
  const still = await control.getApproval(ap.approvalId);
  assert.equal(still.status, "AWAITING_OWNER");
  const nextWork = await pool.query(`SELECT count(*)::int AS n FROM workflow_submissions WHERE brand_id=$1 AND workflow_id LIKE 'wf-ncp-%'`, [PROJ]);
  assert.equal(Number(nextWork.rows[0].n), 0, "no next-cycle workflow exists without Owner decision");
});

test("CASE J: authority triple unchanged by the whole loop", async () => {
  const lc = await lifecycle.workflowLifecycle(WF);
  assert.equal(lc.productionApproval, "NOT_GRANTED");
  assert.equal(lc.publicationApproval, "NOT_GRANTED");
  assert.equal(lc.publicStatus, "NOT_PUBLISHED");
});
