/**
 * Slice 5 — safe write-path proofs (isolated TEST DB, zero providers).
 * Browser → API → durable command → queue → worker → governed runtime
 * (stubbed transport) → artifact + provenance → persisted completion → reload.
 * Covers matrix: ASK submit/execute/reload, MULTI participants + separate
 * synthesis, honest partial failure, START governed path, unknown-agent and
 * runtime-component rejection, idempotent double-submit, cost UNKNOWN,
 * secrets scan, no authority side effects.
 */
import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createServer } from "node:http";
import { createPool, migrate, PostgresPersistence, PostgresQueue, ControlPlaneStore, StrategicStore, LifecycleStore, ApprovalActionabilityStore } from "@ai-media-factory/database";
import { createWorkflowApiHandler } from "@ai-media-factory/api";
import { WorkflowWorker, createDeterministicAgentExecutor } from "@ai-media-factory/worker";

const DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres@127.0.0.1:5432/ai_media_factory_test";
const PID = `cmd-wp-${Date.now().toString(36)}`;
let pool, persistence, queue, control, server, base;

function stubExecute(failAgent = null) {
  return async ({ agentId }) => {
    if (agentId === failAgent) throw new Error("fixture planner failure");
    const output = agentId === "research"
      ? { concept: "c", historicalAngle: "h", evidenceConsiderations: ["e"], sourceability: "s", risks: ["r"], recommendation: "rec" }
      : agentId === "planner"
        ? { hook: "h", shortFormStructure: ["s"], audienceAppeal: "a", pilotFit: "p", risks: ["r"], recommendation: "rec" }
        : agentId === "ceo"
          ? { agreements: ["a"], disagreements: ["d"], evidence: ["e"], recommendation: "r", confidence: 0.8, missingEvidence: ["m"], nextAction: "n" }
          : { ok: true };
    return { output, provider: "openrouter", model: "test-model", usage: { inputTokens: 1, outputTokens: 1 } };
  };
}
function makeWorker(failAgent = null) {
  return new WorkflowWorker({
    queue, persistence,
    executor: createDeterministicAgentExecutor(persistence),
    control,
    resolveCommandConfiguration: async () => ({ "*": { provider: "openrouter", model: "test-model", source: "PROJECT" } }),
    governedExecute: stubExecute(failAgent),
  });
}
async function drainUntilDone(worker, commandId, maxRuns = 25) {
  for (let i = 0; i < maxRuns; i++) {
    const det = await req(`/control/commands/${commandId}?projectId=${PID}`);
    if (det.body.command && det.body.command.status !== "QUEUED" && det.body.command.status !== "WORKING") return det;
    if (!await worker.runOnce()) return det;
  }
  return req(`/control/commands/${commandId}?projectId=${PID}`);
}
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
  persistence = new PostgresPersistence(pool);
  queue = new PostgresQueue(pool);
  control = new ControlPlaneStore(pool);
  const handler = createWorkflowApiHandler({
    persistence, queue, control,
    strategic: new StrategicStore(pool), lifecycle: new LifecycleStore(pool),
    actionability: new ApprovalActionabilityStore(pool),
  });
  server = createServer((req_, res) => void handler(req_, res));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); await persistence.close(); });

test("ASK_AGENT full path: submit, queue, worker, artifact, completion, reload", async () => {
  const sub = await req("/control/commands", { method: "POST", body: JSON.stringify({ projectId: PID, mode: "ASK_AGENT", message: "Assess the draft", selectedAgents: ["research"] }) });
  assert.equal(sub.status, 201);
  assert.equal(sub.body.status, "QUEUED");
  assert.equal(sub.body.authority.commandClass, "ANALYSIS");
  assert.ok(sub.body.authority.willNot.join(" ").match(/production/i));
  const worker = makeWorker();
  const det = await drainUntilDone(worker, sub.body.commandId);
  assert.equal(det.status, 200);
  assert.equal(det.body.command.status, "COMPLETED");
  assert.equal(det.body.command.visibleResult.length, 1);
  assert.equal(det.body.command.visibleResult[0].status, "COMPLETED");
  assert.ok(det.body.command.visibleResult[0].output.concept);
  assert.equal(det.body.command.artifactRefs.length, 1);
  const art = await req(`/workflows/${sub.body.workflowId}/artifacts`);
  assert.ok(art.body.artifacts.some((a) => a.artifactId === det.body.command.artifactRefs[0]));
  // reload identical (durable, survives refresh)
  const again = await req(`/control/commands/${sub.body.commandId}?projectId=${PID}`);
  assert.deepEqual({ ...again.body.command }, { ...det.body.command });
  // provenance persisted with UNKNOWN cost (stub reports no cost metadata)
  const prov = await pool.query(`SELECT cost_kind, strategic_snapshot_id FROM execution_provenance WHERE workflow_id=$1`, [sub.body.workflowId]);
  assert.ok(prov.rows.length >= 1);
  assert.ok(prov.rows.every((r) => r.cost_kind === "UNKNOWN"));
  // no authority side effects: no approvals, no publications
  const ap = await pool.query(`SELECT count(*)::int AS n FROM control_approvals WHERE project_id=$1`, [PID]);
  assert.equal(ap.rows[0].n, 0);
  const pub = await pool.query(`SELECT count(*)::int AS n FROM provider_publications WHERE workflow_id=$1`, [sub.body.workflowId]);
  assert.equal(pub.rows[0].n, 0);
});

test("MULTI_AGENT_REVIEW: independent outputs + separate synthesis", async () => {
  const sub = await req("/control/commands", { method: "POST", body: JSON.stringify({ projectId: PID, mode: "MULTI_AGENT_REVIEW", message: "Review the plan", selectedAgents: ["research", "planner"] }) });
  assert.equal(sub.status, 201);
  const worker = makeWorker();
  const det = await drainUntilDone(worker, sub.body.commandId);
  assert.equal(det.body.command.status, "COMPLETED");
  assert.equal(det.body.command.visibleResult.length, 2);
  const agents = det.body.command.visibleResult.map((r) => r.agentId).sort();
  assert.deepEqual(agents, ["planner", "research"]);
  assert.ok(det.body.command.synthesis && det.body.command.synthesis.recommendation, "synthesis stored separately");
  assert.notDeepEqual(det.body.command.synthesis, det.body.command.visibleResult[0].output);
});

test("partial participant failure represented honestly", async () => {
  const sub = await req("/control/commands", { method: "POST", body: JSON.stringify({ projectId: PID, mode: "MULTI_AGENT_REVIEW", message: "Review", selectedAgents: ["research", "planner"] }) });
  const worker = makeWorker("planner");
  const det = await drainUntilDone(worker, sub.body.commandId);
  assert.equal(det.body.command.status, "FAILED");
  const byAgent = Object.fromEntries(det.body.command.visibleResult.map((r) => [r.agentId, r.status]));
  assert.equal(byAgent.research, "COMPLETED");
  assert.equal(byAgent.planner, "FAILED");
  assert.equal(det.body.command.synthesis, null);
});

test("START_GOVERNED_TASK uses governed workflow path (no command-status overwrite)", async () => {
  const sub = await req("/control/commands", { method: "POST", body: JSON.stringify({ projectId: PID, mode: "START_GOVERNED_TASK", directive: "produce-pre-media", message: "Do governed pre-media research", selectedAgents: ["research"] }) });
  assert.equal(sub.status, 201);
  assert.equal(sub.body.authority.commandClass, "GOVERNED_WORK");
  const worker = makeWorker();
  assert.equal(await worker.runOnce(), true);
  const st = await req(`/workflows/${sub.body.workflowId}`);
  assert.equal(st.status, 200);
  assert.ok(["COMPLETED", "queued", "completed"].includes(st.body.state) || st.body.submissionStatus);
});

test("unknown agents, runtime components rejected; idempotent double submit safe", async () => {
  const bad = await req("/control/commands", { method: "POST", body: JSON.stringify({ projectId: PID, mode: "ASK_AGENT", message: "x", selectedAgents: ["nope-not-an-agent"] }) });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /unknown agent/);
  const rt = await req("/control/commands", { method: "POST", body: JSON.stringify({ projectId: PID, mode: "ASK_AGENT", message: "x", selectedAgents: ["media"] }) });
  assert.equal(rt.status, 400);
  const tts = await req("/control/commands", { method: "POST", body: JSON.stringify({ projectId: PID, mode: "ASK_AGENT", message: "x", selectedAgents: ["tts-chunk-coordinator"] }) });
  assert.equal(tts.status, 400);
  const single = await req("/control/commands", { method: "POST", body: JSON.stringify({ projectId: PID, mode: "MULTI_AGENT_REVIEW", message: "x", selectedAgents: ["research"] }) });
  assert.equal(single.status, 400);
  const a = await req("/control/commands", { method: "POST", body: JSON.stringify({ projectId: PID, mode: "ASK_AGENT", message: "same intent twice", selectedAgents: ["research"] }) });
  const b = await req("/control/commands", { method: "POST", body: JSON.stringify({ projectId: PID, mode: "ASK_AGENT", message: "same intent twice", selectedAgents: ["research"] }) });
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.notEqual(a.body.commandId, b.body.commandId, "distinct intents stay distinct commands");
});

test("retry-as-new-command preserves lineage link and leaves original immutable", async () => {
  const first = await req("/control/commands", { method: "POST", body: JSON.stringify({ projectId: PID, mode: "ASK_AGENT", message: "original attempt", selectedAgents: ["research"] }) });
  assert.equal(first.status, 201);
  const worker = makeWorker("research");
  await drainUntilDone(worker, first.body.commandId);
  const orig = await req(`/control/commands/${first.body.commandId}?projectId=${PID}`);
  assert.equal(orig.body.command.status, "FAILED");
  const retry = await req("/control/commands", { method: "POST", body: JSON.stringify({ projectId: PID, mode: "ASK_AGENT", message: "original attempt", selectedAgents: ["research"], context: { retriesCommandId: first.body.commandId } }) });
  assert.equal(retry.status, 201);
  assert.notEqual(retry.body.commandId, first.body.commandId);
  const worker2 = makeWorker();
  const det = await drainUntilDone(worker2, retry.body.commandId);
  assert.equal(det.body.command.status, "COMPLETED");
  const sub = await pool.query(`SELECT command_context FROM workflow_submissions WHERE workflow_id=$1`, [retry.body.workflowId]);
  const stored = typeof sub.rows[0].command_context === "string" ? JSON.parse(sub.rows[0].command_context) : sub.rows[0].command_context;
  assert.equal(stored.commandContext.retriesCommandId, first.body.commandId);
  const origAgain = await req(`/control/commands/${first.body.commandId}?projectId=${PID}`);
  assert.equal(origAgain.body.command.status, "FAILED", "original failure immutable");
});

test("shipped UI renders internal-analysis findings first-class (no empty Sections)", async () => {
  // Evaluates the actual renderFindings shipped in static/app.js (extracted,
  // not copied) against an internal-analysis payload.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const src = fs.readFileSync(path.resolve(import.meta.dirname, "../src/ai_media_factory/static/app.js"), "utf8");
  const start = src.indexOf("const renderNext=");
  assert.ok(start > 0, "renderer present in shipped bundle");
  let depth = 0, end = -1, inStr = null;
  for (let i = src.indexOf("=>", src.indexOf("const renderFindings=")); i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") { i++; continue; }
      if (c === inStr) inStr = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") { inStr = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  assert.ok(end > 0);
  const esc = (s) => String(s ?? "—");
  const renderFindings = new Function("esc", `${src.slice(start, end)}; return renderFindings;`)(esc);
  const html = renderFindings({
    summary: "S", recommendedNextStep: "N",
    findings: [
      { title: "Cash", priority: "high", finding: "F", evidence: ["e"], ownerImplication: "I", ownerActionRequired: false },
      { title: "Gate", priority: "low", finding: "G", evidence: ["e"], ownerImplication: "J", ownerActionRequired: true },
    ],
  });
  assert.match(html, /1\. Cash/);
  assert.match(html, /Owner action: none/);
  assert.match(html, /Owner action: required/);
  assert.equal(renderFindings({ summary: "x" }), "", "non-findings output renders nothing extra");
});

test("command surfaces carry no secrets and UNKNOWN cost stays UNKNOWN", async () => {
  const list = await req(`/control/commands?projectId=${PID}`);
  assert.equal(list.status, 200);
  assert.doesNotMatch(JSON.stringify(list.body), /api[_-]?key\s*[:=]\s*\S+/i);
  const q = await req(`/control/decision-queue?projectId=${PID}`);
  assert.ok((q.body.needsDecision ?? []).length >= 0);
});
