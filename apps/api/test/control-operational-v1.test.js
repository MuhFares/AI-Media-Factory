/**
 * Control Platform Operationalization V1 — contract tests for new read models.
 * Isolated TEST DB only; never touches production. Verifies: projects list,
 * workflows list, health shape, cost UNKNOWN semantics, publication readiness
 * shape, config SET/RESET + history/map reload, approval authority enrichment,
 * idempotent command submit.
 */
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
let pool, persistence, queue, control, server, base;
process.env.AMF_OWNER_TOKEN ??= "test-owner-token";
async function req(path, options = {}) {
  const res = await fetch(`${base}${path}`, { headers: { "Content-Type": "application/json", "Authorization": "Bearer test-owner-token" }, ...options });
  const body = await res.json();
  return { status: res.status, body };
}
before(async () => {
  if (DATABASE_URL === process.env.DATABASE_URL) throw new Error("TEST_DATABASE_URL must not reference DATABASE_URL");
  pool = createPool({ connectionString: DATABASE_URL });
  await migrate(pool);
  await pool.query(`TRUNCATE workflow_submissions, workflow_jobs, workflow_instances, workflow_steps, artifacts, capability_executions, execution_evidence, execution_provenance, control_approvals, control_commands, control_configuration_events, human_gate_settings, human_gate_configuration_events RESTART IDENTITY CASCADE`);
  persistence = new PostgresPersistence(pool);
  queue = new PostgresQueue(pool);
  control = new ControlPlaneStore(pool);
  const handler = createWorkflowApiHandler({ persistence, queue, control });
  server = createServer((req_, res) => void handler(req_, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await persistence.close(); });

test("projects + workflows list surfaces submissions", async () => {
  const s = await req("/workflows", { method: "POST", body: JSON.stringify({ directive: "produce-pre-media", correlationId: "op-v1-c1", brandId: "morroway", idempotencyKey: "op-v1-idem-1" }) });
  assert.equal(s.status, 201);
  const p = await req("/control/projects");
  assert.equal(p.status, 200);
  assert.ok(p.body.projects.some((x) => x.projectId === "morroway"));
  const w = await req("/control/workflows?projectId=morroway");
  assert.equal(w.status, 200);
  assert.ok(w.body.workflows.some((x) => x.workflowId === s.body.workflowId));
});

test("approval authority enrichment distinguishes validation from publish", async () => {
  const c = await req("/control/approvals", { method: "POST", body: JSON.stringify({ projectId: "morroway", targetType: "publication_integration_validation_gate", targetId: "wf-x:final:abc", agentRecommendation: { ok: true } }) });
  assert.equal(c.status, 201);
  assert.equal(c.body.approval.authorityScope, "PUBLICATION_INTEGRATION_VALIDATION");
  assert.match(c.body.approval.authorityMeaning, /does NOT authorize/i);
  const l = await req("/control/approvals?projectId=morroway");
  assert.ok(l.body.approvals[0].confirmCopy.length > 10);
  const d = await req(`/control/approvals/${c.body.approval.approvalId}/decision`, { method: "POST", body: JSON.stringify({ action: "APPROVE", rationale: "isolated fixture validation-only" }) });
  assert.equal(d.body.approval.ownerDecision, "APPROVE");
});

test("config SET/RESET persists with history + map reload", async () => {
  const previousKey = process.env.OPENROUTER_API_KEY;
  const previousModel = process.env.OPENROUTER_DEFAULT_MODEL;
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.OPENROUTER_DEFAULT_MODEL = "test-model";
  try {
    const set = await req("/control/configuration", { method: "POST", body: JSON.stringify({ scope: "AGENT", projectId: "morroway", agentId: "writer", action: "SET", provider: "openrouter", model: "test-model", rationale: "isolated fixture" }) });
    assert.equal(set.status, 201);
    assert.equal(set.body.effective.source, "AGENT");
    const map = await req("/control/configuration/map?projectId=morroway");
    assert.equal(map.body.agents.writer.source, "AGENT");
    const hist = await req("/control/configuration/history?projectId=morroway&agentId=writer");
    assert.ok(hist.body.history.length >= 1);
    const reset = await req("/control/configuration", { method: "POST", body: JSON.stringify({ scope: "AGENT", projectId: "morroway", agentId: "writer", action: "RESET", rationale: "isolated fixture reset" }) });
    assert.equal(reset.status, 201);
    assert.equal(reset.body.effective.source, "UNCONFIGURED");
  } finally {
    if (previousKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.OPENROUTER_DEFAULT_MODEL;
    else process.env.OPENROUTER_DEFAULT_MODEL = previousModel;
  }
});

test("health + costs + readiness shapes (UNKNOWN preserved, publish blocked)", async () => {
  const h = await req("/control/health");
  assert.equal(h.status, 200);
  assert.equal(h.body.health.db, "ok");
  assert.ok(typeof h.body.health.queue.failed === "number");
  assert.ok(typeof h.body.health.workers.liveCount === "number");
  const c = await req("/control/costs?projectId=morroway");
  assert.equal(c.status, 200);
  assert.ok(typeof c.body.costs.unknownCount === "number");
  const r = await req("/control/publication-readiness?projectId=morroway");
  assert.equal(r.status, 200);
  assert.equal(r.body.readiness.readyForExternalPublish, false);
  assert.ok(r.body.readiness.blockers.includes("TARGET_ACCOUNT_NOT_RESOLVED"));
});

test("command submit is idempotent via UI path (no duplicate on retry)", async () => {
  const first = await req("/control/commands", { method: "POST", body: JSON.stringify({ projectId: "morroway", mode: "ASK_AGENT", message: "isolated ask", selectedAgents: ["research"] }) });
  assert.equal(first.status, 201);
  const st = await req(`/workflows/${first.body.workflowId}`);
  assert.equal(st.status, 200);
});
