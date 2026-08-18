/**
 * PostgresQueue integration tests (Phase 1) against real PostgreSQL.
 *
 * Covers submission idempotency, enqueue/claim (concurrency-safe, attempts),
 * acknowledge, and orphan (crashed-worker) recovery.
 */

import { test, before, after } from "node:test";
import { strictEqual, ok } from "node:assert";
import { createPool, migrate, PostgresPersistence, PostgresQueue } from "@ai-media-factory/database";
import { TEST_DATABASE_URL } from "./helpers.js";

const CONN = TEST_DATABASE_URL;
let pool;
let queue;
let persistence;

function makeDefinition() {
  return {
    id: "content-factory",
    version: 1,
    trigger: { kind: "event", spec: "ExecutiveDirective" },
    entryStep: "planner",
    timeoutSeconds: 300,
    steps: [{ id: "planner", kind: "agent", agent: "planner", emits: "plan" }],
  };
}

function makeSubmission(workflowId, submissionKey) {
  return {
    submissionKey,
    workflowId,
    directive: "plan",
    correlationId: "corr-q",
    brandId: null,
    definition: makeDefinition(),
    status: "submitted",
  };
}

before(async () => {
  pool = createPool({ connectionString: CONN });
  await migrate(pool);
  await pool.query(
    `TRUNCATE workflow_submissions, workflow_jobs, workflow_instances, workflow_steps,
            workflow_checkpoints, artifacts, capability_executions, execution_evidence, decisions
     RESTART IDENTITY CASCADE`
  );
  queue = new PostgresQueue(pool);
  persistence = new PostgresPersistence(pool);
});

after(async () => {
  await persistence.close();
});

test("submission is idempotent by submission_key (no duplicate workflow)", async () => {
  const wf = "wf-q-1";
  const key = "idem-1";
  const first = await queue.submit(makeSubmission(wf, key));
  const second = await queue.submit(makeSubmission(wf, key));
  strictEqual(first.created, true);
  strictEqual(second.created, false, "duplicate submission must not create a second workflow");

  const byKey = await queue.loadSubmissionByKey(key);
  ok(byKey);
  strictEqual(byKey.workflowId, wf);
  const byWf = await queue.loadSubmissionByWorkflow(wf);
  strictEqual(byWf.directive, "plan");
});

test("enqueue → claim (running, attempts++) → ack succeeded", async () => {
  const wf = "wf-q-2";
  await queue.submit(makeSubmission(wf, "idem-2"));
  const jobId = await queue.enqueue(wf, "idem-2");
  ok(typeof jobId === "number");

  const claimed = await queue.claimNextJob();
  ok(claimed);
  strictEqual(claimed.workflowId, wf);
  strictEqual(claimed.status, "running");
  strictEqual(claimed.attempts, 1);

  // A running job is not claimable by another worker.
  strictEqual(await queue.claimNextJob(), null);

  await queue.acknowledge(jobId, "succeeded");
  const done = await queue.getJob(jobId);
  strictEqual(done.status, "succeeded");
});

test("orphaned running job is reclaimed and re-processable (crash recovery)", async () => {
  const wf = "wf-q-3";
  await queue.submit(makeSubmission(wf, "idem-3"));
  await queue.enqueue(wf, "idem-3");
  const claimed = await queue.claimNextJob();
  strictEqual(claimed.status, "running");

  // Simulate a worker that died some time ago (backdate claimed_at).
  await pool.query(
    `UPDATE workflow_jobs SET claimed_at = $1::text WHERE workflow_id = $2::text`,
    ["1999-01-01T00:00:00.000Z", wf]
  );

  // Worker dies before ack → job stays running. Recovery requeues it.
  const reclaimed = await queue.recoverOrphanedJobs(1);
  strictEqual(reclaimed, 1);

  // Now a fresh worker can claim and finish it.
  const reclaimedJob = await queue.claimNextJob();
  ok(reclaimedJob);
  strictEqual(reclaimedJob.workflowId, wf);
  strictEqual(reclaimedJob.attempts, 2, "attempt counter preserved across reclaim");
  await queue.acknowledge(reclaimedJob.jobId, "succeeded");
  strictEqual((await queue.getJob(reclaimedJob.jobId)).status, "succeeded");
});
