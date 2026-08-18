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
} from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";
import { createDeterministicAgentExecutor, WorkflowWorker } from "@ai-media-factory/worker";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory";
const SHIP_AGENTS = ["planner", "research", "coding", "reviewer", "qa", "documentation"];

let pool;
let persistence;
let queue;
let worker;
let server;
let base;

async function request(path, options = {}) {
  const res = await fetch(`${base}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json();
  return { status: res.status, body };
}

before(async () => {
  pool = createPool({ connectionString: DATABASE_URL });
  await migrate(pool);
  await pool.query(
    `TRUNCATE workflow_submissions, workflow_jobs, workflow_instances, workflow_steps,
            workflow_checkpoints, artifacts, capability_executions, execution_evidence, decisions
     RESTART IDENTITY CASCADE`
  );
  persistence = new PostgresPersistence(pool);
  queue = new PostgresQueue(pool);
  worker = new WorkflowWorker({
    queue,
    persistence,
    executor: createDeterministicAgentExecutor(persistence),
    pollMs: 10,
  });

  const handler = createWorkflowApiHandler({ persistence, queue });
  server = createServer((req, res) => void handler(req, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  base = `http://127.0.0.1:${port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await persistence.close();
});

test("POST /workflows enqueues a ship directive and idempotent re-POST returns the same workflow", async () => {
  const first = await request("/workflows", {
    method: "POST",
    body: JSON.stringify({ directive: "ship", correlationId: "api-corr-1", idempotencyKey: "api-idem-1" }),
  });
  assert.equal(first.status, 201);
  assert.equal(first.body.directive, "ship");
  assert.equal(first.body.status, "queued");
  const workflowId = first.body.workflowId;

  const dup = await request("/workflows", {
    method: "POST",
    body: JSON.stringify({ directive: "ship", idempotencyKey: "api-idem-1" }),
  });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.status, "already_submitted");
  assert.equal(dup.body.workflowId, workflowId);

  // No job is executed synchronously by the API; the worker drives completion.
  assert.equal(await worker.runOnce(), true);
  return workflowId;
});

test("GET /workflows/{id} reports COMPLETED after the worker processes it", async () => {
  const res = await request("/workflows", {
    method: "POST",
    body: JSON.stringify({ directive: "ship", correlationId: "api-corr-2" }),
  });
  const workflowId = res.body.workflowId;
  await worker.runOnce();

  const status = await request(`/workflows/${workflowId}`);
  assert.equal(status.status, 200);
  assert.equal(status.body.state, "COMPLETED");
  assert.equal(status.body.submissionStatus, "completed");
  assert.equal(status.body.steps.length, SHIP_AGENTS.length);
  assert.equal(status.body.jobs.length, 1);
});

test("GET artifacts / lineage / executions reflect one output per agent", async () => {
  const res = await request("/workflows", {
    method: "POST",
    body: JSON.stringify({ directive: "ship", correlationId: "api-corr-3" }),
  });
  const workflowId = res.body.workflowId;
  await worker.runOnce();

  const artifacts = await request(`/workflows/${workflowId}/artifacts`);
  assert.equal(artifacts.status, 200);
  assert.equal(artifacts.body.artifacts.length, SHIP_AGENTS.length);

  const lineage = await request(`/workflows/${workflowId}/lineage`);
  assert.equal(lineage.body.lineage.length, SHIP_AGENTS.length);
  const ids = lineage.body.lineage.map((l) => l.artifactId);
  for (let i = 1; i < ids.length; i++) {
    assert.equal(lineage.body.lineage[i].parentArtifact.artifactId, ids[i - 1]);
  }

  const executions = await request(`/workflows/${workflowId}/executions`);
  assert.equal(executions.body.executions.length, SHIP_AGENTS.length);
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