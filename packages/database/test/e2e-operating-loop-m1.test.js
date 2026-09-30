/**
 * E2E Operating Loop Proof M1 — provider-free post-validation dry run.
 * AUTHORIZED BOUNDARY: isolated TEST DB only; 0 live provider calls;
 * 0 LLM; 0 video; 0 publish; 0 live analytics; at most 2 stubbed
 * analytics reads; 0 retries; nothing public; no authority change.
 * Any budget breach or authority escalation fails this proof.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { YouTubeAnalyticsAdapter } from "@ai-media-factory/provider-adapters";
import { createAnalyticsMock } from "../../provider-adapters/test/helpers/mock-servers.ts";
import {
  createPool, migrate, PostgresQueue, ControlPlaneStore, LifecycleStore,
  isValidationAcceptance,
} from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();
if (!process.env.TEST_DATABASE_URL) throw new Error("M1 requires isolated TEST_DATABASE_URL");

const PID = `m1-${Date.now().toString(36)}`;
const WF = `wf-${PID}`;
const PROJ = `${PID}-proj`;
let pool, queue, control, lifecycle, mock;
let stubReads = 0;
const proof = { correlationId: PID, mode: "PLATFORM_VALIDATION_MODE", steps: {} };

before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  queue = new PostgresQueue(pool);
  control = new ControlPlaneStore(pool);
  lifecycle = new LifecycleStore(pool);
  mock = await createAnalyticsMock();
});
after(async () => { try { await mock.close(); } catch {} await pool.end(); });

async function stubRead(publicationId) {
  assert.ok(stubReads < 2, "M1 hard budget: at most 2 stubbed reads");
  const adapter = new YouTubeAnalyticsAdapter({ accessToken: "m1-stub", baseUrl: mock.url, windowDays: 30 });
  const response = await adapter.fetch({ publicationId, platform: "youtube" });
  stubReads += 1;
  return { transport: "STUBBED", liveProviderClaim: false, response };
}

test("STEP 1: isolated fixture at VALIDATION_COMPLETED, authority NOT_GRANTED x3", async () => {
  await queue.submit({
    submissionKey: `${PID}-sub`, workflowId: WF, directive: "produce",
    correlationId: `${PID}-corr`, brandId: PROJ, definition: { stages: [] }, status: "submitted",
  });
  await pool.query(
    `INSERT INTO artifacts (artifact_id,workflow_id,kind,producer_agent,status,payload,content_type,schema_version,created_at)
     VALUES ($1,$2,'publication_integration_validation','validation-harness','completed','{}','application/json','test-v1',$3)`,
    [`${PID}-validation-artifact`, WF, new Date().toISOString()],
  );
  const lc = await lifecycle.workflowLifecycle(WF);
  assert.equal(lc.overallState, "VALIDATION_COMPLETED");
  assert.equal(lc.validationAcceptance, false, "technical success alone is not acceptance");
  assert.equal(lc.productionApproval, "NOT_GRANTED");
  assert.equal(lc.publicationApproval, "NOT_GRANTED");
  assert.equal(lc.publicStatus, "NOT_PUBLISHED");
  proof.steps.startState = { lifecycle: lc.overallState, validationAcceptance: false };
});

test("STEP 2: explicit validation-acceptance decision path (isolated only)", async () => {
  const ap = await control.createApproval({
    approvalId: `${PID}-ap`, projectId: PROJ, targetType: "publication_integration_validation_gate",
    targetId: `${WF}:validation`, agentRecommendation: { engine: "fixture" },
    agentConfidence: null, evidenceRefs: [], status: "AWAITING_OWNER",
    supersedes: null, supersededBy: null, createdAt: new Date().toISOString(),
  });
  const decided = await control.decideApproval(ap.approvalId, "APPROVE", "M1 isolated acceptance fixture", { validationAcceptance: true });
  assert.equal(isValidationAcceptance({
    status: decided.status, owner_decision: decided.ownerDecision,
    target_type: decided.targetType, agent_recommendation: decided.agentRecommendation,
  }), true);
  const lc = await lifecycle.workflowLifecycle(WF);
  assert.equal(lc.validationAcceptance, true);
  assert.equal(lc.productionApproval, "NOT_GRANTED");
  assert.equal(lc.publicationApproval, "NOT_GRANTED");
  assert.equal(lc.publicStatus, "NOT_PUBLISHED");
  proof.steps.validationAcceptance = true;
});

test("STEP 3: final-human-gate observed, nothing toggled or created", async () => {
  const lc = await lifecycle.workflowLifecycle(WF);
  const gateItems = [...lc.attention, ...lc.blockers].filter((x) =>
    /final-human-gate|human.?gate/i.test(JSON.stringify(x)));
  assert.equal(gateItems.length, 0, "no final-human-gate pending on the fixture");
  assert.equal(lc.productionApproval, "NOT_GRANTED", "acceptance not mistaken for production approval");
  const pending = await pool.query(
    `SELECT count(*)::int AS n FROM control_approvals WHERE target_id LIKE $1 AND status<>'DECIDED'`, [`%${WF}%`]);
  assert.equal(Number(pending.rows[0].n), 0, "no live Owner approval created");
  proof.steps.finalHumanGate = "observed-no-pending-gate";
});

test("STEP 4: publisher authorization/preflight provider-free, NOT_GRANTED honored", async () => {
  const readiness = await control.publicationReadiness(PROJ, WF);
  assert.equal(readiness.integrationValidation, "PASS");
  assert.equal(readiness.productionApproval, "NO");
  assert.equal(readiness.publicPublishApproval, "NO");
  assert.equal(readiness.readyForExternalPublish, false);
  assert.ok(readiness.blockers.length > 0, "blockers recorded, progression correctly prevented");
  const pubs = await pool.query(`SELECT count(*)::int AS n FROM provider_publications WHERE workflow_id=$1`, [WF]);
  assert.equal(Number(pubs.rows[0].n), 0, "no external publication path entered");
  proof.steps.publisherPreflight = { providerFree: true, honored: true };
});

test("STEP 5: stubbed analytics proof, max 2 reads, 0 retries, STUBBED only", async () => {
  const r1 = await stubRead("vid-1");
  assert.equal(r1.transport, "STUBBED");
  assert.equal(r1.liveProviderClaim, false);
  assert.equal(r1.response.providerId, "youtube-analytics");
  assert.equal(r1.response.metrics.views, 1234);
  mock.state.mode = "empty";
  const r2 = await stubRead("vid-empty");
  assert.deepEqual(r2.response.metrics, {});
  assert.equal(r2.transport, "STUBBED");
  assert.equal(stubReads, 2);
  assert.equal(mock.state.requests, 2, "exactly one request per read, zero retries");
  proof.steps.analytics = { transport: "STUBBED", reads: stubReads, shape: "views/likes/comments/shares/revenue/watchTimeSeconds" };
});

test("STEP 6+8: learning assessment recorded; budget and authority assertions", async () => {
  const caps = await pool.query(`SELECT count(*)::int AS n FROM capability_executions WHERE workflow_id=$1`, [WF]);
  assert.equal(Number(caps.rows[0].n), 0, "no capability executions on the fixture workflow");
  proof.steps.learning = "PARTIAL";
  proof.authorityBefore = { production: "NOT_GRANTED", publication: "NOT_GRANTED", public: "NOT_PUBLISHED" };
  const lc = await lifecycle.workflowLifecycle(WF);
  proof.authorityAfter = {
    production: lc.productionApproval, publication: lc.publicationApproval, public: lc.publicStatus,
  };
  assert.deepEqual(proof.authorityAfter, { production: "NOT_GRANTED", publication: "NOT_GRANTED", public: "NOT_PUBLISHED" });
  assert.ok(stubReads <= 2 && stubReads >= 1);
  proof.budget = { liveExternal: 0, llm: 0, video: 0, publish: 0, liveAnalytics: 0, stubbedReads: stubReads, retries: 0 };
  proof.status = "M1_DRY_RUN_COMPLETE";
});
