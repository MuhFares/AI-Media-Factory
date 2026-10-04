/**
 * Phase 1 submission API integration tests.
 *
 * POST /workflows enqueues a durable job (never executes synchronously);
 * a WorkflowWorker consumes it; GET endpoints surface status, artifacts,
 * lineage and capability executions. Submission identity is idempotent.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import {
  createPool,
  migrate,
  PostgresPersistence,
  PostgresQueue,
  ControlPlaneStore,
} from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";
import { createDeterministicAgentExecutor, WorkflowWorker } from "@ai-media-factory/worker";

process.env.AMF_OWNER_TOKEN ??= "test-owner-token";
const DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
const PRE_MEDIA_AGENTS = ["orchestrator", "research", "ceo", "planner", "writer", "director", "visual-director", "review", "qa"];

let pool;
let persistence;
let queue;
let worker;
let server;
let base;

async function request(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json", "Authorization": "Bearer test-owner-token" },
    ...options,
  });
  const body = await res.json();
  return { status: res.status, body };
}

before(async () => {
  if (DATABASE_URL === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");
  }
  pool = createPool({ connectionString: DATABASE_URL });
  await migrate(pool);
  await pool.query(
    `TRUNCATE workflow_submissions, workflow_jobs, workflow_instances, workflow_steps,
            workflow_checkpoints, artifacts, capability_executions, execution_evidence, decisions,
            control_approvals, control_commands, control_configuration_events
     RESTART IDENTITY CASCADE`
  );
  persistence = new PostgresPersistence(pool);
  queue = new PostgresQueue(pool);
  const control = new ControlPlaneStore(pool);
  worker = new WorkflowWorker({
    queue,
    persistence,
    control,
    executor: createDeterministicAgentExecutor(persistence),
    resolveCommandConfiguration: async () => ({ "*": { provider: "openrouter", model: "test-model", source: "PROJECT" } }),
    pollMs: 10,
  });

  const handler = createWorkflowApiHandler({ persistence, queue, control });
  server = createServer((req, res) => void handler(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await persistence.close();
});

test("POST /workflows enqueues a canonical pre-media directive and idempotent re-POST returns the same workflow", async () => {
  const first = await request("/workflows", {
    method: "POST",
    body: JSON.stringify({ directive: "produce-pre-media", correlationId: "api-corr-1", brandId: "morroway", idempotencyKey: "api-idem-1" }),
  });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  assert.equal(first.body.directive, "produce-pre-media");
  assert.equal(first.body.status, "queued");
  const workflowId = first.body.workflowId;

  const dup = await request("/workflows", {
    method: "POST",
    body: JSON.stringify({ directive: "produce-pre-media", brandId: "morroway", idempotencyKey: "api-idem-1" }),
  });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.status, "already_submitted");
  assert.equal(dup.body.workflowId, workflowId);

  // No job is executed synchronously by the API; the worker drives completion.
  assert.equal(await worker.runOnce(), true);
  return workflowId;
});

test("GET /workflows/{id} reports the canonical Owner pre-media gate after worker processing", async () => {
  const res = await request("/workflows", {
    method: "POST",
    body: JSON.stringify({ directive: "produce-pre-media", correlationId: "api-corr-2", brandId: "morroway" }),
  });
  const workflowId = res.body.workflowId;
  await worker.runOnce();

  const status = await request(`/workflows/${workflowId}`);
  assert.equal(status.status, 200);
  assert.equal(status.body.state, "AWAITING_APPROVAL");
  assert.equal(status.body.submissionStatus, "owner_pre_media_review_required", JSON.stringify(status.body));
  assert.equal(status.body.steps.length, PRE_MEDIA_AGENTS.length + 1);
  assert.equal(status.body.jobs.length, 1);
});

test("GET artifacts / lineage / executions reflect one output per agent", async () => {
  const res = await request("/workflows", {
    method: "POST",
    body: JSON.stringify({ directive: "produce-pre-media", correlationId: "api-corr-3", brandId: "morroway" }),
  });
  const workflowId = res.body.workflowId;
  await worker.runOnce();

  const artifacts = await request(`/workflows/${workflowId}/artifacts`);
  assert.equal(artifacts.status, 200);
  assert.equal(artifacts.body.artifacts.length, PRE_MEDIA_AGENTS.length);

  const lineage = await request(`/workflows/${workflowId}/lineage`);
  assert.equal(lineage.body.lineage.length, PRE_MEDIA_AGENTS.length);
  const ids = lineage.body.lineage.map((l) => l.artifactId);
  for (let i = 1; i < ids.length; i++) {
    assert.equal(lineage.body.lineage[i].parentArtifact.artifactId, ids[i - 1]);
  }

  const executions = await request(`/workflows/${workflowId}/executions`);
  assert.equal(executions.body.executions.length, PRE_MEDIA_AGENTS.length);
});

test("validation + not-found behavior", async () => {
  const missing = await request("/workflows", {
    method: "POST",
    body: JSON.stringify({ correlationId: "x" }),
  });
  assert.equal(missing.status, 400);

  const badDirective = await request("/workflows", {
    method: "POST",
    body: JSON.stringify({ directive: "launch-missiles" }),
  });
  assert.equal(badDirective.status, 400);

  const notFound = await request("/workflows/wf-does-not-exist");
  assert.equal(notFound.status, 404);
});

test("control approvals preserve agent recommendation and record owner override", async () => {
  const created = await request("/control/approvals", { method: "POST", body: JSON.stringify({ projectId: "morroway", targetType: "artifact", targetId: "artifact-1", agentRecommendation: { recommendation: "hold" }, agentConfidence: "high", evidenceRefs: ["evidence-1"] }) });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.approval.agentRecommendation, { recommendation: "hold" });
  const id = created.body.approval.approvalId;
  const decided = await request(`/control/approvals/${id}/decision`, { method: "POST", body: JSON.stringify({ action: "OVERRIDE", rationale: "Owner accepts the documented risk." }) });
  assert.equal(decided.status, 200);
  assert.equal(decided.body.approval.ownerDecision, "OVERRIDE");
  assert.deepEqual(decided.body.approval.agentRecommendation, { recommendation: "hold" });
});

test("control command dispatch persists context and queues a governed workflow", async () => {
  const dispatched = await request("/control/commands", { method: "POST", body: JSON.stringify({ projectId: "morroway", mode: "ANALYZE", message: "Assess the recorded brand architecture", selectedAgents: ["research"], context: { artifactRefs: ["art-brand-architecture-v1"], contentId: "MW-HIS-001" } }) });
  assert.equal(dispatched.status, 201);
  assert.equal(dispatched.body.status, "QUEUED");
  const history = await request("/control/commands?projectId=morroway");
  assert.equal(history.status, 200);
  assert.equal(history.body.commands[0].context.contentId, "MW-HIS-001");
  const status = await request(`/workflows/${dispatched.body.workflowId}`);
  assert.equal(status.status, 200);
  assert.equal(status.body.state, "queued");
});
