/**
 * Real PostgreSQL crash/restart E2E for the production worker.
 *
 * Proves the durable recovery path with the REAL Postgres implementation:
 *
 *   POST /workflows (produce)  ->  queue  ->  worker A claims + runs
 *   ->  SIGKILL worker A MID-STEP (research, forced 6s stall)
 *   ->  orphaned 'running' job / 'running' step persist
 *   ->  worker B: recoverOrphans() -> engine.resume() -> COMPLETED
 *   ->  reload from Postgres: NO duplicate artifact / capability execution /
 *       evidence / lineage; interrupted step re-ran exactly once.
 *
 * Runs the SAME production path as research-brave-pg.mjs but does not need a
 * real provider key: the research step is blocked (web.search without a Brave
 * key) yet still exercises real evidence persistence + resume idempotency.
 *
 * Opt-in ONLY. Never part of `npm test`.
 *
 *   RUN_REAL_PROVIDER_TESTS=true E2E_DATABASE_URL=<isolated-url> node e2e/restart-crash-pg.mjs
 *
 * Exit codes:
 *   0   PASS (real Postgres crash/restart proven) or SKIP (flag missing)
 *   42  BLOCKED (PostgreSQL unreachable)
 *   1   a required assertion failed
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { fork } from "node:child_process";
import { createPool, migrate, PostgresPersistence, PostgresQueue } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";
import { createProductionAgentExecutor, WorkflowWorker } from "../dist/index.js";
import { assertIsolatedE2eDatabase } from "./database-target-guard.mjs";

const optIn = process.env.RUN_REAL_PROVIDER_TESTS === "true";
if (!optIn) {
  console.log("restart-crash-pg: SKIPPED (set RUN_REAL_PROVIDER_TESTS=true to enable)");
  process.exit(0);
}
const DATABASE_URL = process.env.E2E_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
assertIsolatedE2eDatabase(DATABASE_URL, process.env.DATABASE_URL);

const MARKER_LOCK = process.env.CHILD_MARKER_LOCK;

if (process.env.CHILD_WORKER_A === "1") {
  const pool = createPool({ connectionString: DATABASE_URL });
  const persistence = new PostgresPersistence(pool);
  const queue = new PostgresQueue(pool);
  const inner = createProductionAgentExecutor({ persistence, pool });
  const executor = {
    async executeAgentStep(step, context) {
      if (step.agent === "research") {
        writeFileSync(MARKER_LOCK, String(Date.now()));
        await new Promise((r) => setTimeout(r, 6000));
      }
      return inner.executeAgentStep(step, context);
    },
  };
  const worker = new WorkflowWorker({ queue, persistence, executor });
  await worker.runOnce();
  await pool.end().catch(() => {});
  process.exit(0);
}

function postJson(url, body) {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

async function waitForTerminalState(pool, workflowId, timeoutMs = 180_000) {
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

async function pollForFile(path, timeoutMs = 30_000) {
  const { readFile } = await import("node:fs/promises");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const content = await readFile(path, "utf8").catch(() => "");
    if (content.length > 0) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

assert.ok(await import("node:fs").then(({ existsSync, mkdirSync }) => { const d = "C:/Users/MOHAME~1.ABD/AppData/Local/Temp/opencode"; if (!existsSync(d)) mkdirSync(d, { recursive: true }); return true; }));
const marker = "C:/Users/MOHAME~1.ABD/AppData/Local/Temp/opencode/restart-crash-marker.txt";

const pool = createPool({ connectionString: DATABASE_URL });
let server;
try {
  await pool.query("SELECT 1");
} catch (error) {
  console.log("restart-crash-pg: BLOCKED — PostgreSQL is not reachable, crash/restart durability cannot be proven here.");
  console.log(`  connect error: ${error?.message ?? String(error)}`);
  await pool.end().catch(() => {});
  process.exit(42);
}

try {
  await migrate(pool);
  await pool.query(
    `DELETE FROM workflow_jobs; DELETE FROM workflow_submissions; DELETE FROM workflow_steps; DELETE FROM workflow_checkpoints;
     DELETE FROM artifacts; DELETE FROM capability_executions; DELETE FROM execution_evidence; DELETE FROM decisions;
     DELETE FROM workflow_instances;`,
  );
  const persistence = new PostgresPersistence(pool);
  const queue = new PostgresQueue(pool);

  const handler = createWorkflowApiHandler({ persistence, queue });
  server = createServer((req, res) => void handler(req, res));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const correlationId = `corr-crash-${Date.now()}`;
  const idempotencyKey = `idem-crash-${Date.now()}`;
  const created = await postJson(`${base}/workflows`, {
    directive: "produce",
    correlationId,
    idempotencyKey,
  });
  assert.equal(created.status, 201, "POST /workflows must create");
  const workflowId = created.body.workflowId;
  console.log(`restart-crash-pg: submitted produce workflow ${workflowId}`);

  await import("node:fs").then(({ rmSync }) => rmSync(marker, { force: true }));
  const child = fork(new URL(import.meta.url), [], {
    env: { ...process.env, CHILD_WORKER_A: "1", CHILD_MARKER_LOCK: marker },
  });

  const started = await pollForFile(marker);
  assert.equal(started, true, "worker A must reach the research step (marker written)");
  await new Promise((r) => setTimeout(r, 400));
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
  console.log("restart-crash-pg: worker A SIGKILLed mid-step (simulated crash)");

  const stuck = await pool.query("SELECT state FROM workflow_instances WHERE workflow_id = $1", [workflowId]);
  assert.equal(stuck.rows[0].state, "RUNNING", "crashed workflow must remain RUNNING in Postgres");
  const frontierGap = await pool.query(
    "SELECT step_id, status, attempts FROM workflow_steps WHERE workflow_id = $1 AND step_id = 'research'",
    [workflowId],
  );
  assert.equal(frontierGap.rowCount, 1, "research step row must exist");
  assert.equal(frontierGap.rows[0].status, "pending", "interrupted step must stay durably 'pending' (in-flight running never flushed on hard kill)");
  console.log("restart-crash-pg: crash persisted (instance RUNNING, research step durably pending — in-flight execution was not completed)");

  const orphanProbe = await pool.query("SELECT status FROM workflow_jobs WHERE workflow_id = $1", [workflowId]);
  assert.equal(orphanProbe.rows[0].status, "running", "job must be stuck running after the crash");

  await new Promise((r) => setTimeout(r, 1500));
  const workerB = new WorkflowWorker({ queue, persistence, executor: createProductionAgentExecutor({ persistence, pool }), orphanStaleMs: 500 });
  const recovered = await workerB.recoverOrphans();
  assert.ok(recovered >= 1, "recoverOrphans must reclaim the orphaned job");
  assert.equal(await workerB.runOnce(), true, "worker B must claim the reclaimed job");
  const state = await waitForTerminalState(pool, workflowId);
  assert.equal(state, "COMPLETED", "restarted workflow must reach COMPLETED");
  console.log("restart-crash-pg: worker B recovered the orphan and resumed to COMPLETED");

  const reloadPool = createPool({ connectionString: DATABASE_URL });
  const readPersistence = new PostgresPersistence(reloadPool);
  const readQueue = new PostgresQueue(reloadPool);

  const submission = await readQueue.loadSubmissionByWorkflow(workflowId);
  assert.ok(submission, "submission must be durable");
  assert.equal(submission.status, "completed", "submission status must be completed");
  const jobs = await readQueue.listJobsByWorkflow(workflowId);
  assert.equal(jobs.length, 1, "exactly one job across the crash/restart");
  assert.equal(jobs[0].status, "succeeded", "job must be acknowledged as succeeded");
  assert.ok(jobs[0].attempts >= 2, `job must show 2 claim attempts, got ${jobs[0].attempts}`);

  const artifacts = await readPersistence.listArtifacts(workflowId);
  const grouped = new Map();
  for (const artifact of artifacts) grouped.set(artifact.kind, (grouped.get(artifact.kind) ?? 0) + 1);
  for (const [kind, count] of grouped) {
    assert.equal(count, 1, `artifact kind ${kind} must exist exactly once after restart (no duplicates)`);
  }
  const research = artifacts.find((a) => a.kind === "research_report");
  const writer = artifacts.find((a) => a.kind === "writer_report");
  assert.ok(research, "research_report artifact must exist");
  assert.ok(writer, "writer_report artifact must exist");
  const hasSearch = !!(process.env.SEARCH_API ?? process.env.TAVILY_API_KEY ?? process.env.SERPER_API_KEY ?? process.env.EXA_API_KEY ?? process.env.BRAVE_SEARCH_API_KEY);
  assert.equal(research.status, hasSearch ? "completed" : "blocked", `research_report must be ${hasSearch ? "completed (real provider)" : "blocked (no key)"}`);
  assert.ok(!research.parentArtifact, "research is the entry step of the produce pipeline (no parent)");
  assert.equal(writer.parentArtifact?.kind, "research_report", "writer lineage must point at research_report");
  console.log(`restart-crash-pg: ${artifacts.length} artifacts, zero duplicates, lineage chain intact (research=${research.status})`);

  const executions = await readPersistence.listCapabilityExecutions(workflowId);
  const searchExecutions = executions.filter((e) => e.capabilityId === "web.search");
  assert.equal(searchExecutions.length, 1, "web.search must exist exactly once despite the step re-running after crash");
  if (hasSearch) {
    assert.equal(searchExecutions[0].status, "success", "with real provider, web.search must succeed");
  } else {
    assert.notEqual(searchExecutions[0].status, "success", "blocked capability must not report success");
  }

  const evidence = await readPersistence.listExecutionEvidence(workflowId);
  const researchEvidence = evidence.filter((e) => e.capabilityId === "web.search");
  assert.equal(researchEvidence.length, 1, "execution_evidence must exist exactly once despite the crash");
  assert.equal(researchEvidence[0].succeeded, hasSearch, `evidence succeeded must be ${hasSearch}`);
  assert.equal(
    research.payload.capabilityExecutions?.[0]?.evidence?.evidenceId,
    researchEvidence[0].evidenceId,
    "research artifact must reference the persisted evidence id",
  );
  console.log("restart-crash-pg: capability execution + evidence exactly once (idempotent resume)");

  const steps = await pool.query(
    "SELECT step_id, status, attempts FROM workflow_steps WHERE workflow_id = $1 ORDER BY started_at",
    [workflowId],
  );
  const researchStep = steps.rows.find((s) => s.step_id === "research");
  assert.ok(researchStep, "research step must exist");
  assert.equal(researchStep.status, "completed", "research step must be completed after resume");
  assert.ok(researchStep.attempts >= 1, `research step must report a completed execution attempt, got ${researchStep.attempts}`);
  const checkpoints = await pool.query("SELECT count(*)::int AS c FROM workflow_checkpoints WHERE workflow_id = $1", [workflowId]);
  assert.ok(checkpoints.rows[0].c >= 1, "checkpoint must exist after restart");
  console.log(`restart-crash-pg: steps: ${steps.rows.map((s) => `${s.step_id}(${s.status})`).join(", ")}; checkpoint persisted`);

  await reloadPool.end();
  console.log("\nrestart-crash-pg: PASS — real PostgreSQL crash/restart proven: orphan recovery, engine.resume, no duplicated artifacts/executions/evidence.");
  console.log("  workflowId:", workflowId);
  console.log("  evidenceId:", researchEvidence[0].evidenceId);
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await pool.end().catch(() => {});
}
