/**
 * WorkflowWorker end-to-end execution test (Phase 1 async pipeline).
 *
 * Exercises the full durable chain: API → Queue → Worker → Engine → DB.
 * Uses the deterministic executor (no LLM) so the run is reproducible.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import {
  createPool,
  migrate,
  PostgresPersistence,
  PostgresQueue,
} from "@ai-media-factory/database";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";
import { createDeterministicAgentExecutor, WorkflowWorker } from "@ai-media-factory/worker";
import { truncateAll, TEST_DATABASE_URL } from "./helpers.js";

const SHIP_AGENTS = ["planner", "research", "coding", "reviewer", "qa", "documentation"];

let pool;
let persistence;
let queue;
let worker;

before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  await truncateAll(pool);
  persistence = new PostgresPersistence(pool);
  queue = new PostgresQueue(pool);
  worker = new WorkflowWorker({
    queue,
    persistence,
    executor: createDeterministicAgentExecutor(persistence),
    pollMs: 10,
  });
});

after(async () => {
  await persistence.close();
});

test("worker runs a ship directive end-to-end with one artifact + evidence per agent", async () => {
  const workflowId = "wf-ex1";
  const submissionKey = "ex-1";
  const definition = directiveToWorkflowDefinition("ship");

  await queue.submit({
    submissionKey,
    workflowId,
    directive: "ship",
    correlationId: "corr-ex1",
    brandId: null,
    definition,
  });
  await queue.enqueue(workflowId, submissionKey);

  const handled = await worker.runOnce();
  assert.equal(handled, true);

  const instance = await persistence.loadWorkflow(workflowId);
  assert.equal(instance?.state, "COMPLETED");

  // Exactly one artifact per agent, correctly linked lineage.
  const artifacts = await persistence.listArtifacts(workflowId);
  assert.equal(artifacts.length, SHIP_AGENTS.length);
  const byAgent = new Map(artifacts.map((a) => [a.producerAgent, a]));
  for (const agent of SHIP_AGENTS) {
    assert.ok(byAgent.has(agent), `missing artifact from ${agent}`);
    assert.equal(byAgent.get(agent).status, "completed");
  }
  for (let i = 1; i < SHIP_AGENTS.length; i++) {
    const prev = byAgent.get(SHIP_AGENTS[i - 1]);
    const cur = byAgent.get(SHIP_AGENTS[i]);
    assert.equal(cur.parentArtifact?.artifactId, prev.artifactId, `lineage ${SHIP_AGENTS[i]}`);
  }

  // Exactly one capability execution per agent.
  const caps = await persistence.listCapabilityExecutions(workflowId);
  assert.equal(caps.length, SHIP_AGENTS.length);
  for (const agent of SHIP_AGENTS) {
    assert.equal(caps.filter((c) => c.agentId === agent).length, 1);
  }

  // Queue + submission statuses resolved.
  const submission = await queue.loadSubmissionByWorkflow(workflowId);
  assert.equal(submission?.status, "completed");
  const job = await queue.getJob(Number(await jobIdFor(workflowId)));
  assert.equal(job?.status, "succeeded");
  assert.equal(job?.error, null);
});

async function jobIdFor(workflowId) {
  const res = await pool.query(
    `SELECT job_id FROM workflow_jobs WHERE workflow_id = $1::text`,
    [workflowId]
  );
  return res.rows[0].job_id;
}