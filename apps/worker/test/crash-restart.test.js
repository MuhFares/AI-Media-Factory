/**
 * Worker crash-and-restart recovery test.
 *
 * Worker 1 crashes mid-workflow (after the planner, while `research` is
 * in-flight) leaving its queue job `running` and the workflow instance
 * partially checkpointed. Worker 2 recovers orphaned jobs, resumes the
 * workflow from the checkpoint, and completes it WITHOUT re-running the
 * already-successful planner — no duplicated artifacts / evidence / lineage.
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
import {
  buildDefaultEngine,
  createDeterministicAgentExecutor,
  WorkflowWorker,
} from "@ai-media-factory/worker";
import { WorkflowCrashError } from "@ai-media-factory/workflow-engine";
import { truncateAll, TEST_DATABASE_URL } from "./helpers.js";

const SHIP_AGENTS = ["planner", "research", "coding", "reviewer", "qa", "documentation"];

let pool;
let persistence;
let queue;

before(async () => {
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  await truncateAll(pool);
  persistence = new PostgresPersistence(pool);
  queue = new PostgresQueue(pool);
});

after(async () => {
  await persistence.close();
});

async function waitFor(check, label, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
}

test("resumes a crashed workflow without duplicating artifacts / evidence / lineage", async () => {
  const workflowId = "wf-crash";
  const submissionKey = "crash-1";
  const definition = directiveToWorkflowDefinition("ship");

  await queue.submit({
    submissionKey,
    workflowId,
    directive: "ship",
    correlationId: "corr-crash",
    brandId: null,
    definition,
  });
  await queue.enqueue(workflowId, submissionKey);

  // Worker 1 claims the job, then crashes after the planner (research in-flight).
  await queue.claimNextJob();
  const crashingExecutor = {
    async executeAgentStep(step, context) {
      if (step.agent === "planner") {
        return createDeterministicAgentExecutor(persistence).executeAgentStep(step, context);
      }
      throw new WorkflowCrashError(`crash during ${step.id}`);
    },
  };
  const engine1 = buildDefaultEngine({
    persistence,
    executor: crashingExecutor,
    definitionLoader: async () => definition,
  });
  await engine1.start({
    definition,
    trigger: { directive: "ship" },
    correlationId: "corr-crash",
    brandId: null,
    workflowId,
  });

  // Give the engine a moment to persist the completed planner + in-flight crash.
  await waitFor(async () => {
    const inst = await persistence.loadWorkflow(workflowId);
    const planner = inst?.steps.find((s) => s.stepId === "planner");
    const research = inst?.steps.find((s) => s.stepId === "research");
    return inst.state === "RUNNING" && planner?.status === "completed" && research?.status === "running";
  }, "worker-1 checkpoint with planner done");

  // Worker 1 died: persists exactly one artifact + one capability execution.
  assert.equal((await persistence.listArtifacts(workflowId)).length, 1);
  assert.equal((await persistence.listCapabilityExecutions(workflowId)).length, 1);

  // Backdate the running job's claimed_at so worker 2 treats it as a stale orphan.
  await pool.query(
    `UPDATE workflow_jobs SET claimed_at = $1::text WHERE workflow_id = $2::text`,
    ["1999-01-01T00:00:00.000Z", workflowId]
  );

  // Worker 2 starts: recovers the orphan and resumes from the checkpoint.
  const worker2 = new WorkflowWorker({
    queue,
    persistence,
    executor: createDeterministicAgentExecutor(persistence),
    orphanStaleMs: 1,
    pollMs: 10,
  });
  assert.equal(await worker2.recoverOrphans(), 1);
  assert.equal(await worker2.runOnce(), true);

  const instance = await persistence.loadWorkflow(workflowId);
  assert.equal(instance?.state, "COMPLETED");

  // Final state: exactly 6 artifacts (planner NOT duplicated), lineage intact,
  // exactly one capability execution per agent.
  const artifacts = await persistence.listArtifacts(workflowId);
  assert.equal(artifacts.length, SHIP_AGENTS.length);
  const byAgent = new Map(artifacts.map((a) => [a.producerAgent, a]));
  for (let i = 1; i < SHIP_AGENTS.length; i++) {
    const prev = byAgent.get(SHIP_AGENTS[i - 1]);
    const cur = byAgent.get(SHIP_AGENTS[i]);
    assert.equal(cur.parentArtifact?.artifactId, prev.artifactId, `lineage ${SHIP_AGENTS[i]}`);
  }

  const caps = await persistence.listCapabilityExecutions(workflowId);
  assert.equal(caps.length, SHIP_AGENTS.length);
  for (const agent of SHIP_AGENTS) {
    assert.equal(caps.filter((c) => c.agentId === agent).length, 1, `once for ${agent}`);
  }

  // Queue + submission resolved.
  const submission = await queue.loadSubmissionByWorkflow(workflowId);
  assert.equal(submission?.status, "completed");
  const res = await pool.query(
    `SELECT status, attempts, error FROM workflow_jobs WHERE workflow_id = $1::text`,
    [workflowId]
  );
  assert.equal(res.rows[0].status, "succeeded");
  assert.equal(res.rows[0].attempts, 2);
  assert.equal(res.rows[0].error, null);
});