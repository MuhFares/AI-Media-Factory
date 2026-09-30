/**
 * Real Research -> web.search -> provider (Brave or Tavily) -> PostgreSQL E2E.
 *
 * Proves the Phase 2 production path end-to-end with a REAL provider:
 *
 *   POST /workflows  ->  Postgres submission + queue  ->  Worker claim
 *   ->  ProductionAgentExecutor  ->  ResearchAgent  ->  web.search capability
 *   ->  BraveSearchAdapter OR TavilySearchAdapter  ->  real provider API
 *   ->  ExecutionEvidence ->  research_report artifact  ->  PostgreSQL
 *   (reload + lineage verified)
 *
 * The provider is chosen by the search provider registry: registering a
 * credential (SEARCH_API/TAVILY_API_KEY, SERPER_API_KEY, EXA_API_KEY or
 * BRAVE_SEARCH_API_KEY) activates that provider; SEARCH_PROVIDER overrides the
 * selection when several are configured. This test expects the same provider
 * the registry would activate and asserts it in evidence + the report.
 *
 * Real providers can be slow or briefly rate-limited (Tavily's advanced search
 * depth in particular). Use a generous web-search timeout/retry for the proof:
 *
 *   RUN_REAL_PROVIDER_TESTS=true WEB_SEARCH_TIMEOUT_MS=30000
 *     WEB_SEARCH_MAX_RETRIES=4 node --env-file=.env
 *     apps/worker/e2e/research-brave-pg.mjs
 *
 * Opt-in ONLY. It is never part of `npm test`.
 *
 * Exit codes:
 *   0   PASS (real provider + Postgres proven) or SKIP (flag/key missing)
 *   42  BLOCKED (PostgreSQL unreachable — durability cannot be proven here)
 *   1   a required assertion failed
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";
import { createProductionAgentExecutor, WorkflowWorker } from "../dist/index.js";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";

const optIn = process.env.RUN_REAL_PROVIDER_TESTS === "true";
if (!optIn) {
  console.log("research-brave-pg: SKIPPED (set RUN_REAL_PROVIDER_TESTS=true to enable)");
  process.exit(0);
}
const SEARCH_CREDENTIAL_ORDER = [
  "SEARCH_API", "SEARCH_API_TAVILY", "TAVILY_API_KEY",
  "SEARCH_API_SERPER", "SERPER_API_KEY",
  "SEARCH_API_EXA", "EXA_API_KEY",
  "SEARCH_API_BRAVE", "BRAVE_SEARCH_API_KEY", "BRAVE_API_KEY",
];
const PROVIDER_ID_FOR = {
  SEARCH_API: "tavily-search",
  SEARCH_API_TAVILY: "tavily-search",
  TAVILY_API_KEY: "tavily-search",
  SEARCH_API_SERPER: "serper",
  SERPER_API_KEY: "serper",
  SEARCH_API_EXA: "exa",
  EXA_API_KEY: "exa",
  SEARCH_API_BRAVE: "brave-search",
  BRAVE_SEARCH_API_KEY: "brave-search",
  BRAVE_API_KEY: "brave-search",
};
const SHORT_ALIAS_TO_ID = { tavily: "tavily-search", brave: "brave-search", serper: "serper", exa: "exa" };
const configuredCredential = SEARCH_CREDENTIAL_ORDER.find((key) => process.env[key]?.trim());
if (configuredCredential === undefined) {
  console.log("research-brave-pg: SKIPPED (no search credential configured — set SEARCH_API, SEARCH_API_SERPER, SEARCH_API_EXA or SEARCH_API_BRAVE)");
  process.exit(0);
}
const providerIds = new Set(Object.values(PROVIDER_ID_FOR));
const preferred = process.env.SEARCH_PROVIDER?.trim().toLowerCase();
let EXPECTED_PROVIDER_ID = PROVIDER_ID_FOR[configuredCredential];
if (preferred !== undefined && preferred.length > 0) {
  const resolved = SHORT_ALIAS_TO_ID[preferred] ?? preferred;
  if (!providerIds.has(resolved)) {
    throw new Error(`SEARCH_PROVIDER '${preferred}' is unknown (expected one of ${[...providerIds].join(", ")})`);
  }
  const matchingCredential = SEARCH_CREDENTIAL_ORDER.find((key) => PROVIDER_ID_FOR[key] === resolved && process.env[key]?.trim());
  if (matchingCredential === undefined) {
    throw new Error(`SEARCH_PROVIDER '${preferred}' requested but its credential is not set`);
  }
  EXPECTED_PROVIDER_ID = resolved;
}

const DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";
const CORRELATION_ID = `corr-brave-e2e-${Date.now()}`;
const IDEMPOTENCY_KEY = `idem-brave-e2e-${Date.now()}`;

async function tryConnect(pool) {
  await pool.query("SELECT 1");
}

function postJson(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

async function waitForTerminalState(pool, workflowId, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const probe = await pool.query("SELECT state FROM workflow_instances WHERE workflow_id = $1", [workflowId]);
    if (probe.rowCount === 1 && ["COMPLETED", "FAILED", "CANCELLED"].includes(probe.rows[0].state)) {
      return probe.rows[0].state;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`timed out waiting for terminal state on ${workflowId}`);
}

const pool = createPool({ connectionString: DATABASE_URL });
let server;

try {
  await tryConnect(pool);
} catch (error) {
  console.log("research-brave-pg: BLOCKED — PostgreSQL is not reachable, durability cannot be proven in this environment.");
  console.log("  DATABASE_URL: [configured; redacted]");
  console.log(`  connect error: ${error?.message ?? String(error)}`);
  console.log("  Required infrastructure: any PostgreSQL 13+ instance (e.g. `docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres` ).");
  console.log("  The test + wiring are prepared; re-run this script once Postgres is up.");
  await pool.end().catch(() => {});
  process.exit(42);
}

try {
  await migrate(pool);
const persistence = new PostgresPersistence(pool);
const queue = new PostgresQueue(pool);
const executor = createProductionAgentExecutor({ persistence, pool });

// Real HTTP entry point, exactly as apps/api serves it.
const handler = createWorkflowApiHandler({ persistence, queue });
server = createServer((req, res) => void handler(req, res));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

console.log(`research-brave-pg: submitting directive="research" (RESEARCH template = planner + research; only research invokes a real provider)`);
const created = await postJson(`${base}/workflows`, {
  directive: "research",
  correlationId: CORRELATION_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
});
assert.equal(created.status, 201, "POST /workflows must create");
assert.equal(created.body.status, "queued", "submission must be queued");
const workflowId = created.body.workflowId;
assert.equal(created.body.correlationId, CORRELATION_ID);
console.log(`research-brave-pg: created workflow ${workflowId}`);

// Duplicate POST with the same idempotency key must not create a duplicate.
const dup = await postJson(`${base}/workflows`, {
  directive: "research",
  correlationId: CORRELATION_ID,
  idempotencyKey: IDEMPOTENCY_KEY,
});
assert.equal(dup.status, 200, "duplicate submission must return the existing workflow");
assert.equal(dup.body.workflowId, workflowId, "duplicate submission must reuse the same workflow");
assert.equal(dup.body.status, "already_submitted");
console.log("research-brave-pg: duplicate submission deduplicated (same workflow id)");

// Real worker claims + executes through the durable engine.
const worker = new WorkflowWorker({ queue, persistence, executor });
const claimed = await worker.runOnce();
assert.equal(claimed, true, "worker must claim the submitted job");
const state = await waitForTerminalState(pool, workflowId);
assert.equal(state, "COMPLETED", "workflow must complete");
console.log("research-brave-pg: worker claimed + ran the workflow to COMPLETED");

// ---------------------------------------------------------------------------
// Reload EVERYTHING from PostgreSQL with fresh adapters (post-execution reads).
// ---------------------------------------------------------------------------
const reloadPool = createPool({ connectionString: DATABASE_URL });
const readPersistence = new PostgresPersistence(reloadPool);
const readQueue = new PostgresQueue(reloadPool);

const submission = await readQueue.loadSubmissionByWorkflow(workflowId);
assert.ok(submission, "submission must be durable");
assert.equal(submission.status, "completed", "submission status must be completed");
const jobs = await readQueue.listJobsByWorkflow(workflowId);
assert.equal(jobs.length, 1, "exactly one job");
assert.equal(jobs[0].status, "succeeded", "job must be acknowledged as succeeded");

const artifacts = await readPersistence.listArtifacts(workflowId);
assert.ok(artifacts.length >= 2, "planner + research artifacts must be persisted");
const research = artifacts.find((a) => a.kind === "research_report");
assert.ok(research, "research_report artifact must be persisted");
const plan = artifacts.find((a) => a.kind === "execution_plan");
assert.ok(plan, "execution_plan artifact must be persisted");

assert.equal(plan.producerAgent, "planner");
assert.equal(research.producerAgent, "research");
assert.equal(research.workflowId, workflowId);
assert.equal(research.correlationId, CORRELATION_ID);
assert.equal(research.status, "completed", "research artifact must be completed (real provider success)");
assert.equal(research.parentArtifact?.artifactId, plan.artifactId, "research lineage must point at its parent execution_plan");
assert.equal(research.parentArtifact?.kind, "execution_plan", "research lineage kind must match");

const payload = research.payload;
const meta = payload.metadata ?? {};
assert.equal(meta.providerInfo?.providerId, EXPECTED_PROVIDER_ID, `report must record ${EXPECTED_PROVIDER_ID} as the provider`);
assert.ok(meta.providerInfo?.resultCount > 0, "report must record > 0 real results");
assert.ok(Array.isArray(payload.sources) && payload.sources.length > 0, "report sources must be grounded in real results");
for (const source of payload.sources) {
  assert.ok(source.url && source.url.includes("://"), `real result URL required, got ${source.url}`);
  assert.ok(!source.url.includes("example.com"), "report must never fabricate example.com sources");
}
assert.equal(
  meta.providerInfo.evidenceId,
  payload.capabilityExecutions?.[0]?.evidence?.evidenceId,
  "report must reference the persisted evidence id",
);
console.log(`research-brave-pg: research_report grounded in ${meta.providerInfo.resultCount} real ${EXPECTED_PROVIDER_ID} results`);

const executions = await readPersistence.listCapabilityExecutions(workflowId);
const searchExecution = executions.find((e) => e.capabilityId === "web.search");
assert.ok(searchExecution, "web.search capability execution must be persisted");
assert.equal(searchExecution.agentId, "research", "agentId must be research");
assert.equal(searchExecution.status, "success", "capability execution must report success");
assert.equal(searchExecution.workflowId, workflowId);
assert.equal(searchExecution.correlationId, CORRELATION_ID);
const searchPayload = searchExecution.payload;
assert.equal(searchPayload.capabilityId, "web.search");
assert.equal(searchPayload.evidence.providerInvoked, true, "evidence must report the provider was actually invoked");
assert.equal(searchPayload.evidence.succeeded, true, "evidence must report success");
assert.equal(searchPayload.evidence.providerId, EXPECTED_PROVIDER_ID);
console.log(`research-brave-pg: capability execution persisted (providerInvoked=${searchPayload.evidence.providerInvoked}, succeeded=${searchPayload.evidence.succeeded}, results=${searchPayload.evidence.resultCount})`);

const evidence = await readPersistence.listExecutionEvidence(workflowId);
const evidenceRow = evidence.find((e) => e.capabilityId === "web.search");
assert.ok(evidenceRow, "execution_evidence row must be persisted");
assert.equal(evidenceRow.succeeded, true, "execution_evidence.succeeded must be true");
assert.equal(evidenceRow.agentId, "research");
assert.equal(evidenceRow.workflowId, workflowId);
assert.equal(evidenceRow.correlationId, CORRELATION_ID);
console.log("research-brave-pg: ExecutionEvidence durable (succeeded=true)");

// API query endpoints reflect the durable store after the worker finished.
const apiArtifacts = await fetch(`${base}/workflows/${workflowId}/artifacts`).then((r) => r.json());
assert.equal(apiArtifacts.workflowId, workflowId);
assert.ok(apiArtifacts.artifacts.some((a) => a.kind === "research_report"));
const apiExecutions = await fetch(`${base}/workflows/${workflowId}/executions`).then((r) => r.json());
assert.ok(apiExecutions.executions.some((e) => e.capabilityId === "web.search" && e.status === "success"));
const apiStatus = await fetch(`${base}/workflows/${workflowId}`).then((r) => r.json());
assert.equal(apiStatus.state, "COMPLETED");
console.log("research-brave-pg: API reload endpoints (status/artifacts/executions) read from Postgres");

// Crash-replay idempotency probe: a re-claimed pass (empty queue) must not
// duplicate any artifact or capability execution.
assert.equal(await worker.recoverOrphans(), 0, "no orphaned running jobs after completion");
assert.equal(await worker.runOnce(), false, "queue must be empty on re-run (no duplicate work)");
const executionsAfter = await readPersistence.listCapabilityExecutions(workflowId);
assert.equal(executionsAfter.filter((e) => e.capabilityId === "web.search").length, 1, "re-run must not duplicate capability executions");
assert.equal((await readPersistence.listArtifacts(workflowId)).length, artifacts.length, "re-run must not duplicate artifacts");
console.log("research-brave-pg: restart/re-claim probe idempotent (no duplicates)");

await reloadPool.end();
console.log(`\nresearch-brave-pg: PASS — Research -> web.search -> ${EXPECTED_PROVIDER_ID} -> PostgreSQL proven with real provider data.`);
console.log("  evidenceId:", evidenceRow.evidenceId);
console.log("  workflowId:", workflowId);
console.log("  correlationId:", CORRELATION_ID);
} finally {
  const closePromises = [];
  if (server) closePromises.push(new Promise((resolve) => server.close(resolve)));
  closePromises.push(pool.end().catch(() => {}));
  await Promise.allSettled(closePromises);
}
