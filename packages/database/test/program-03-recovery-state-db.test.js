import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { createPool, migrate, PostgresQueue, PostgresWorkerSingletonLease, RecoveryReconciliationSweeper } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

let pool;
before(async () => {
  assertTestDatabaseIsolation();
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  await pool.query(`TRUNCATE workflow_recovery_dispatches,workflow_jobs,workflow_submissions,workflow_instances,amf_worker_presence RESTART IDENTITY CASCADE`);
});
after(async () => { await pool.end(); });

test("S/T/U: DB singleton admits first, blocks second, and releases on owner loss", async () => {
  const first = new PostgresWorkerSingletonLease(pool, "program-03-test", "canonical-production-queue-worker");
  const second = new PostgresWorkerSingletonLease(pool, "program-03-test", "canonical-production-queue-worker");
  assert.equal(await first.acquire(), "ACQUIRED");
  assert.equal(await second.acquire(), "ALREADY_HELD");
  assert.equal(await first.heartbeat(), true);
  await first.release();
  assert.equal(await second.acquire(), "ACQUIRED");
  await second.release();
});

test("V/AD: healthy long-running job lease is not reclaimed; dead claimant is", async () => {
  const queue = new PostgresQueue(pool);
  const now = new Date().toISOString();
  await queue.submit({ submissionKey: "p3-long", workflowId: "wf-p3-long", directive: "produce", correlationId: "corr", brandId: "test-project", definition: { id: "p3", version: 1, trigger: { kind: "event", spec: "test" }, entryStep: "writer", steps: [{ id: "writer", kind: "agent", agent: "writer", emits: "writer_report" }] } });
  const jobId = await queue.enqueue("wf-p3-long", "p3-long");
  await pool.query(`INSERT INTO amf_worker_presence(worker_instance_id,build_id,runtime_mode,launcher,node_version,started_at,last_heartbeat_at,process_id,singleton_key,worker_role) VALUES('worker-live','build','PERSISTENT_PRODUCTION_WORKER','test','v', $1,$1,1,'p3','canonical-production-queue-worker')`, [now]);
  assert.equal((await queue.claimNextJob("worker-live")).jobId, jobId);
  await pool.query(`UPDATE workflow_jobs SET claimed_at='1999-01-01T00:00:00.000Z',lease_heartbeat_at='1999-01-01T00:00:00.000Z' WHERE job_id=$1`, [jobId]);
  assert.equal(await queue.recoverOrphanedJobs(1), 0, "live worker protects a slow job");
  await pool.query(`UPDATE amf_worker_presence SET last_heartbeat_at='1999-01-01T00:00:00.000Z' WHERE worker_instance_id='worker-live'`);
  assert.equal(await queue.recoverOrphanedJobs(1), 1, "dead claimant permits deterministic reclaim");
});

test("AE: reconciliation sweeper reports split-brain and orphan authorization without mutation", async () => {
  const now = new Date().toISOString();
  await pool.query(`INSERT INTO workflow_instances(workflow_id,definition_id,definition_version,state,context,ready,created_at,updated_at) VALUES('wf-conflict','p3',1,'COMPLETED','{}','[]',$1,$1)`, [now]);
  await pool.query(`INSERT INTO workflow_submissions(submission_key,workflow_id,directive,definition,status,created_at,updated_at) VALUES('p3-conflict','wf-conflict','produce','{}','submitted',$1,$1)`, [now]);
  const running = await pool.query(`INSERT INTO workflow_jobs(workflow_id,submission_key,status,attempts,created_at,updated_at) VALUES('wf-conflict','p3-conflict','running',1,$1,$1) RETURNING job_id`, [now]);
  await pool.query(`INSERT INTO workflow_recovery_dispatches(authorization_key,workflow_id,submission_key,recovery_execution_id,recovery_of_execution_id,original_execution_id,recovery_reason,authorization_status,dispatch_status,created_at) VALUES('auth-orphan','wf-conflict','p3-conflict','recovery-orphan','source','original','test','OWNER_APPROVED','PENDING',$1)`, [now]);
  const findings = await new RecoveryReconciliationSweeper(pool).scan();
  assert.ok(findings.some((f) => f.code === "RUNNING_JOB_TERMINAL_WORKFLOW" && f.jobId === Number(running.rows[0].job_id)));
  assert.ok(findings.some((f) => f.code === "AUTHORIZATION_WITHOUT_JOB" && f.recoveryId === "recovery-orphan"));
  assert.equal((await pool.query(`SELECT state FROM workflow_instances WHERE workflow_id='wf-conflict'`)).rows[0].state, "COMPLETED");
});
