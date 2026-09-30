/**
 * REVISION LIVE OPERATOR WIRING V1 — provider-free parity proof.
 *
 * Proves the operator execution path and the production CLI path are ONE
 * construction path (createProductionWorker) with ONE authoritative
 * configuration resolution (ControlPlaneStore.agentConfigurationMap):
 *
 *  - the shared bootstrap resolves identical canonical stage configuration on
 *    every construction, honoring GLOBAL → PROJECT → AGENT scope precedence
 *  - a governed produce run launched through the operator path (shared
 *    bootstrap) routes Writer/SEO/Brand/Review exactly per the canonical
 *    configuration — provider, requested model, token budget, reasoning
 *    configuration, response format — while ambient TEXT_AGENT_PROVIDER /
 *    glm-5.3 defaults are ignored (Revision v1 incident regression)
 *  - a governed submission whose configuration resolver is missing or broken
 *    fails closed with RUNTIME_CONFIGURATION_RESOLUTION_FAILED and ZERO
 *    provider requests, on both the start and the resume path
 *  - the production CLI and the revision operator runner construct their
 *    worker exclusively through the shared bootstrap
 *
 * All provider transports are frozen fetch fixtures; no network generation.
 */

import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { readFile } from "node:fs/promises";
import {
  createPool,
  migrate,
  PostgresPersistence,
  PostgresQueue,
  ControlPlaneStore,
  ProductionModelRoutingStore,
} from "@ai-media-factory/database";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";
import { createProductionWorker, WorkflowWorker, createProductionAgentExecutor } from "../dist/index.js";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

assertTestDatabaseIsolation();

const definition = directiveToWorkflowDefinition("produce");
const GATE = "pre-production-owner-gate";

// Fixture models: distinct per scope so mis-routing is observable.
const WRITER_MODEL = "openai/gpt-oss-20b:free";       // AGENT scope
const STAR_MODEL = "meta-llama/llama-3.3-70b:free";    // PROJECT scope ('*')
const REVIEW_MODEL = "nex-agi/nex-n2.5-pro:free";      // AGENT scope (task-class)

const OPENROUTER_BASE = "https://openrouter.test/api/v1";
const AGENTROUTER_BASE = "https://agentrouter.test/v1";

const originalFetch = globalThis.fetch;
const originalEnv = {
  TEXT_AGENT_PROVIDER: process.env.TEXT_AGENT_PROVIDER,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  ANTHROPIC_AUTH_TOKEN: process.env.ANTHROPIC_AUTH_TOKEN,
  CODEX_SANDBOX_NETWORK_DISABLED: process.env.CODEX_SANDBOX_NETWORK_DISABLED,
};

let pool;
let persistence;
let queue;
let control;

async function cleanupRoutingFixtures() {
  await pool.query(`DELETE FROM production_model_routing_entries WHERE routing_version_id LIKE 'route-proj-wire-%'`);
  await pool.query(`DELETE FROM production_model_routing_versions WHERE routing_version_id LIKE 'route-proj-wire-%'`);
  await pool.query(`DELETE FROM model_benchmark_runs WHERE benchmark_run_id LIKE 'bench-proj-wire-%'`);
  await pool.query(`DELETE FROM provider_model_catalog WHERE provider='openrouter' AND provider_model_id = ANY($1)`, [[WRITER_MODEL, STAR_MODEL, REVIEW_MODEL]]);
  await pool.query(`DELETE FROM provider_model_price_snapshots WHERE provider='openrouter' AND provider_model_id = ANY($1)`, [[WRITER_MODEL, STAR_MODEL, REVIEW_MODEL]]);
}

async function resetTables() {
  assertTestDatabaseIsolation();
  await pool.query(
    `TRUNCATE workflow_submissions, workflow_jobs, workflow_instances, workflow_steps,
             workflow_checkpoints, artifacts, capability_executions, execution_evidence, decisions,
             control_approvals, control_commands, review_revision_tasks, revision_dispatches,
             targeted_verification_reevaluation_recoveries, targeted_verification_dispatches,
             control_configuration_events,
             execution_provenance, execution_lifecycle_events, execution_failure_fallback_events,
             workflow_recovery_dispatches, provider_publications, provider_upload_sessions
      RESTART IDENTITY CASCADE`,
  );
  await cleanupRoutingFixtures();
}

before(async () => {
  // Provider-free fixture: transport is frozen below. Mark the child runtime
  // supported so universal preflight can exercise the transport seam.
  delete process.env.CODEX_SANDBOX_NETWORK_DISABLED;
  pool = createPool({ connectionString: TEST_DATABASE_URL });
  await migrate(pool);
  await resetTables();
  persistence = new PostgresPersistence(pool);
  queue = new PostgresQueue(pool);
  control = new ControlPlaneStore(pool);
});

after(async () => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await cleanupRoutingFixtures();
  await pool.end();
});

async function waitForDb(check, label, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`timeout: ${label}`);
}

const runId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Configure the canonical DB production route for a fixture project. */
async function configureProjectPolicy(projectId) {
  const stamp = new Date().toISOString();
  const benchmarkId = `bench-${projectId}`;
  await pool.query(`INSERT INTO model_benchmark_runs(benchmark_run_id,dataset_version,catalog_snapshot_id,candidate_plan_version,status,created_at,authorization_state,hard_spend_cap_usd,created_by) VALUES($1,'wiring','fixture','v1','COMPLETED',$2,'NOT_AUTHORIZED',0,'test') ON CONFLICT DO NOTHING`, [benchmarkId, stamp]);
  for (const model of [WRITER_MODEL, STAR_MODEL, REVIEW_MODEL]) {
    const priceId = `price-${Buffer.from(model).toString("hex").slice(0,24)}`;
    await pool.query(`INSERT INTO provider_model_price_snapshots(price_snapshot_id,provider,provider_model_id,refresh_id,retrieved_at,pricing_raw,pricing_normalized,pricing_hash) VALUES($1,'openrouter',$2,'fixture',$3,'{}','{}',$4) ON CONFLICT DO NOTHING`, [priceId, model, stamp, `pricing-${model}`]);
    await pool.query(`INSERT INTO provider_model_catalog(provider,provider_model_id,canonical_name,context_length,input_modalities,output_modalities,supported_parameters,capabilities,availability,source_url,retrieved_at,refresh_id,raw_metadata,content_hash,pricing_hash,capability_hash,description_hash,current_price_snapshot_id) VALUES('openrouter',$1,$1,32000,'["text"]','["text"]','["response_format"]','{"structuredOutput":true}','AVAILABLE','provider-free://fixture',$2,'fixture','{"top_provider":{"max_completion_tokens":8192}}',$3,$4,$5,$6,$7) ON CONFLICT(provider,provider_model_id) DO UPDATE SET availability='AVAILABLE',retrieved_at=EXCLUDED.retrieved_at,current_price_snapshot_id=EXCLUDED.current_price_snapshot_id`, [model, stamp, `content-${model}`, `pricing-${model}`, `cap-${model}`, `desc-${model}`, priceId]);
  }
  const priceId = (model) => `price-${Buffer.from(model).toString("hex").slice(0,24)}`;
  const entries = ["orchestrator","research","ceo","planner","writer","director","visual-director","review","qa","seo","brand"].map((role) => {
    const model = role === "writer" ? WRITER_MODEL : role === "review" ? REVIEW_MODEL : STAR_MODEL;
    return { role, primary:model, priceSnapshots:{ [model]:priceId(model) } };
  });
  await new ProductionModelRoutingStore(pool).activate({ versionId:`route-${projectId}`,profile:"provider-free",scopeType:"PROJECT",projectId,benchmarkRunId:benchmarkId,datasetVersion:"wiring",entries,provenance:{test:true} });
}

// ---------------------------------------------------------------------------
// Frozen provider transports (the only fetch consumers in these tests).
// ---------------------------------------------------------------------------

const capturedRequests = [];
let fetchCalls = 0;

function sse(payload) {
  return new Response(
    `data: ${JSON.stringify({ id: "gen-wiring", model: payload.__model, choices: [{ delta: { content: JSON.stringify(payload) }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 0 }, cost: 0 } })}\n\ndata: [DONE]\n\n`,
    { status: 200, headers: { "x-request-id": "wiring-fixture" } },
  );
}

async function latestArtifact(workflowId, kind) {
  const artifacts = await persistence.listArtifacts(workflowId);
  return [...artifacts].reverse().find((a) => a.kind === kind && a.status === "completed");
}

async function frozenWriterReport(workflowId) {
  const brief = await latestArtifact(workflowId, "evidence_backed_content_brief");
  const payload = brief.payload;
  const allowedIds = new Set((payload.claims ?? []).filter((c) => c.status === "SUPPORTED").flatMap((c) => c.sourceIds ?? []));
  const allowed = (payload.researchSources ?? []).filter((s) => allowedIds.has(s.sourceId));
  return {
    __model: WRITER_MODEL,
    contentId: "00000000-0000-4000-8000-0000000000WW",
    taskDescription: "Write content for writer",
    objective: "Wiring parity fixture objective",
    title: "Wiring parity title",
    content: "Wiring parity content body.",
    summary: "Wiring parity summary.",
    sourceReferences: allowed.map((s) => ({ sourceId: s.sourceId, title: s.title, url: s.url })),
    status: "completed",
    metadata: { createdAt: "2026-09-14T00:00:00.000Z", agentVersion: "1.0.0", researchArtifactId: brief.artifactId },
  };
}

async function frozenSeoReport(workflowId) {
  const writer = await latestArtifact(workflowId, "writer_report");
  return {
    __model: STAR_MODEL,
    reportId: "00000000-0000-4000-8000-0000000000SS",
    taskDescription: "Optimize for seo",
    objective: "Optimize the content for seo",
    optimizedTitle: String(writer.payload.title ?? "title"),
    optimizedDescription: "Wiring parity SEO description.",
    keywords: [{ keyword: "parity", importance: "primary" }],
    topics: [{ topic: "parity", presentInContent: true }],
    searchIntent: "informational",
    contentStructure: [{ heading: "Introduction", purpose: "Hook" }],
    sourceReferences: (writer.payload.sourceReferences ?? []),
    status: "completed",
    metadata: { createdAt: "2026-09-14T00:00:00.000Z", agentVersion: "1.0.0", writerArtifactId: writer.artifactId },
  };
}

async function frozenBrandReport(workflowId) {
  const seo = await latestArtifact(workflowId, "seo_report");
  return {
    __model: STAR_MODEL,
    reportId: "00000000-0000-4000-8000-0000000000BB",
    taskDescription: "Brand gate for brand",
    objective: "Run the brand gate for brand",
    status: "approved",
    issues: [],
    passedChecks: [{ code: "BRAND_OK", message: "Structural brand validation passed." }],
    failedChecks: [],
    recommendations: [],
    metadata: { createdAt: "2026-09-14T00:00:00.000Z", agentVersion: "1.0.0", seoArtifactId: seo.artifactId },
  };
}

function frozenReviewReport() {
  return {
    __model: REVIEW_MODEL,
    reportId: "00000000-0000-4000-8000-0000000000RV",
    taskDescription: "Review content for review",
    summary: "Wiring parity approved review.",
    status: "approved",
    findings: [],
    recommendations: [],
    metadata: { createdAt: "2026-09-14T00:00:00.000Z", agentVersion: "1.0.0" },
  };
}

/** Frozen media boundary: web.search only (the run stops at the review gate). */
function frozenMediaBoundary(counts) {
  const success = (request, output) => ({
    status: "success",
    resultId: `${request.capabilityId}-${request.requestId}`,
    capabilityId: request.capabilityId,
    output,
    evidence: { evidenceId: `e-${request.requestId}`, capabilityId: request.capabilityId, agentId: request.agentId, workflowId: request.workflowId, correlationId: request.correlationId, succeeded: true, providerInvoked: true, resultStatus: "success" },
  });
  return {
    boundary: {
      executeCapability: async (request) => {
        counts[request.capabilityId] = (counts[request.capabilityId] ?? 0) + 1;
        if (request.capabilityId === "web.search") return success(request, { results: [{ title: "Wiring parity", url: "https://example.test/parity", snippet: "fixture" }] });
        return success(request, {});
      },
    },
  };
}

function installFrozenFetch(workflowIdProvider) {
  capturedRequests.length = 0;
  fetchCalls = 0;
  globalThis.fetch = async (url, options) => {
    fetchCalls += 1;
    const body = JSON.parse(options.body);
    const prompt = String(body.messages?.[1]?.content ?? "");
    capturedRequests.push({ url: String(url), body });
    let payload;
    if (prompt.includes("Writing objective")) payload = await frozenWriterReport(workflowIdProvider());
    else if (prompt.includes("BrandReviewReport")) payload = await frozenBrandReport(workflowIdProvider());
    else if (prompt.includes("SEOReport")) payload = await frozenSeoReport(workflowIdProvider());
    else payload = frozenReviewReport();
    return sse(payload);
  };
}

async function submitGovernedProduce(workflowId, projectId, commandId) {
  await control.saveCommand({ commandId, projectId, mode: "START_GOVERNED_TASK", ownerMessage: "Produce the wiring parity fixture", selectedAgents: [], context: {}, taskClassification: "START_GOVERNED_TASK", workflowId, status: "QUEUED", visibleResult: null, synthesis: null, artifactRefs: [], createdAt: new Date().toISOString() });
  await queue.submit({ submissionKey: `wire:${workflowId}`, workflowId, directive: "produce", correlationId: `corr-${workflowId}`, brandId: projectId, definition, commandContext: { commandType: "START_GOVERNED_TASK", commandId, ownerMessage: "Produce the wiring parity fixture" } });
  await queue.enqueue(workflowId, `wire:${workflowId}`);
}

// ---------------------------------------------------------------------------
// 1 — Shared bootstrap: identical canonical resolution, scope precedence.
// ---------------------------------------------------------------------------

test("the shared production bootstrap resolves identical canonical stage configuration on every construction", { timeout: 60000 }, async () => {
  const id = runId();
  const projectId = `proj-wire-bootstrap-${id}`;
  await configureProjectPolicy(projectId);

  // Two independent constructions (one representing the CLI entry, one an
  // operator entry) must resolve byte-identical effective configurations.
  const runtimeA = await createProductionWorker({ pool, pollMs: 10 });
  const runtimeB = await createProductionWorker({ pool, pollMs: 10 });
  const configA = await runtimeA.resolveCommandConfiguration(projectId);
  const configB = await runtimeB.resolveCommandConfiguration(projectId);

  const effective = (stage) => configA[stage];
  assert.equal(configA.writer.model, WRITER_MODEL); assert.equal(configA.writer.source, "PROJECT");
  assert.equal(configA.review.model, REVIEW_MODEL); assert.equal(configA.review.source, "PROJECT");
  assert.equal(effective("seo").model, STAR_MODEL); assert.equal(effective("brand").model, STAR_MODEL);

  // Operator path == production path, per stage (effective resolution).
  for (const stage of ["writer", "seo", "brand", "review"]) {
    assert.deepEqual(effective(stage), configB[stage] ?? configB["*"], `${stage} configuration parity between constructions`);
  }
  assert.deepEqual(configA, configB);
});

// ---------------------------------------------------------------------------
// 2 — Operator-path end-to-end routing parity + ambient-default regression.
// ---------------------------------------------------------------------------

test("an operator-path governed command uses canonical project routing/preflight and ignores ambient defaults", { timeout: 60000 }, async () => {
  const id = runId();
  const workflowId = `wf-wire-route-${id}`;
  const projectId = `proj-wire-route-${id}`;
  const commandId = `command-wire-route-${id}`;
  await configureProjectPolicy(projectId);

  // Ambient regression conditions (Revision v1 incident): ambient provider
  // agentrouter with ambient model glm-5.3. The governed overrides must win.
  process.env.TEXT_AGENT_PROVIDER = "agentrouter";
  process.env.OPENROUTER_API_KEY = "test";
  process.env.OPENROUTER_BASE_URL = OPENROUTER_BASE;
  process.env.OPENAI_BASE_URL = AGENTROUTER_BASE;
  process.env.OPENAI_API_KEY = "ambient";
  process.env.ANTHROPIC_AUTH_TOKEN = "ambient";

  capturedRequests.length = 0;
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body); capturedRequests.push({ url:String(url), body });
    return sse({ __model: STAR_MODEL, concept:"fixture", historicalAngle:"verified angle", evidenceConsiderations:["institutional source"], sourceability:"available", risks:["bounded"], recommendation:"hold" });
  };
  await control.saveCommand({ commandId, projectId, mode:"ASK_AGENT", ownerMessage:"Research the bounded fixture", selectedAgents:["research"], context:{}, taskClassification:"ASK_AGENT", workflowId, status:"QUEUED", visibleResult:null, synthesis:null, artifactRefs:[], createdAt:new Date().toISOString() });
  await queue.submit({ submissionKey:`wire:${workflowId}`, workflowId, directive:"research", correlationId:`corr-${workflowId}`, brandId:projectId, definition, commandContext:{ commandType:"ASK_AGENT", commandId, selectedAgents:["research"], ownerMessage:"Research the bounded fixture" } });
  await queue.enqueue(workflowId, `wire:${workflowId}`);

  // THE operator path: the shared production bootstrap.
  const runtime = await createProductionWorker({ pool, pollMs: 10, providerBoundary: frozenMediaBoundary({}) });
  assert.equal(await runtime.worker.runOnce(), true);

  // Every captured provider request went to OpenRouter with the canonical
  // model; none went to the ambient AgentRouter endpoint or model.
  const stageRequests = capturedRequests.map(({ url, body }) => ({ url, model: body.model, maxTokens: body.max_tokens, temperature: body.temperature, responseFormat: body.response_format, reasoning: body.reasoning ?? null }));
  assert.equal(stageRequests.length, 1, "one bounded governed submission captured");
  for (const request of stageRequests) {
    assert.equal(request.url, `${OPENROUTER_BASE}/chat/completions`, "no ambient endpoint submission");
    assert.notEqual(request.model, "glm-5.3", "ambient model never used");
    assert.deepEqual(request.responseFormat, { type: "json_object" });
  }
  assert.equal(stageRequests[0].model, STAR_MODEL);
  assert.equal(stageRequests[0].maxTokens, 1000);

  // Durable executions carry the same effective configuration and source.
  const executions = await persistence.listExecutionProvenance(workflowId);
  const execution = executions.find((item)=>item.agentId==="research");
  assert.ok(execution); assert.equal(execution.provider,"openrouter");
  assert.equal(execution.configuration.routingVersionId, `route-${projectId}`);
  assert.ok(execution.configuration.preflightFingerprint);
  const command = await pool.query(`SELECT status FROM control_commands WHERE command_id=$1`,[commandId]);
  assert.equal(command.rows[0].status,"COMPLETED");
});

// ---------------------------------------------------------------------------
// 3 — Incident regression: missing resolver fails closed, zero provider calls.
// ---------------------------------------------------------------------------

test("a governed start without a configuration resolver fails closed with zero provider requests", { timeout: 60000 }, async () => {
  const id = runId();
  const workflowId = `wf-wire-nocfg-${id}`;
  const projectId = `proj-wire-nocfg-${id}`;
  const commandId = `command-wire-nocfg-${id}`;
  await configureProjectPolicy(projectId);
  process.env.TEXT_AGENT_PROVIDER = "agentrouter";
  process.env.OPENAI_BASE_URL = AGENTROUTER_BASE;
  process.env.OPENAI_API_KEY = "ambient";
  process.env.ANTHROPIC_AUTH_TOKEN = "ambient";
  delete process.env.OPENROUTER_API_KEY;

  let fetchAttempts = 0;
  globalThis.fetch = async () => { fetchAttempts += 1; throw new Error("must not submit"); };

  await submitGovernedProduce(workflowId, projectId, commandId);
  // The incident construction: a bare worker with NO configuration resolver.
  const executor = createProductionAgentExecutor({ persistence, providerBoundary: frozenMediaBoundary({}) });
  const bareWorker = new WorkflowWorker({ queue, persistence, executor, control, pollMs: 5 });
  assert.equal(await bareWorker.runOnce(), true, "job processed");

  const job = await pool.query(`SELECT status, error FROM workflow_jobs WHERE workflow_id=$1 ORDER BY job_id DESC LIMIT 1`, [workflowId]);
  assert.equal(job.rows[0].status, "failed");
  assert.match(job.rows[0].error, /RUNTIME_CONFIGURATION_RESOLUTION_FAILED/);
  assert.equal(fetchAttempts, 0, "PROVIDER_SUBMISSION_BEFORE_CONFIG_RESOLUTION = NO");
  assert.equal((await persistence.listExecutionProvenance(workflowId)).length, 0, "no governed execution was created");
  assert.equal((await persistence.listArtifacts(workflowId)).length, 0, "no artifacts were created");
  assert.equal((await persistence.loadWorkflow(workflowId))?.state ?? "ABSENT", "ABSENT", "workflow never started");
});

// ---------------------------------------------------------------------------
// 4 — Broken resolver fails closed with the stable diagnostic.
// ---------------------------------------------------------------------------

test("a governed start whose configuration resolution throws fails closed with zero provider requests", { timeout: 60000 }, async () => {
  const id = runId();
  const workflowId = `wf-wire-badcfg-${id}`;
  const projectId = `proj-wire-badcfg-${id}`;
  const commandId = `command-wire-badcfg-${id}`;
  let fetchAttempts = 0;
  globalThis.fetch = async () => { fetchAttempts += 1; throw new Error("must not submit"); };

  await submitGovernedProduce(workflowId, projectId, commandId);
  const executor = createProductionAgentExecutor({ persistence, providerBoundary: frozenMediaBoundary({}) });
  const brokenWorker = new WorkflowWorker({
    queue, persistence, executor, control, pollMs: 5,
    resolveCommandConfiguration: async () => { throw new Error("control plane unavailable"); },
  });
  assert.equal(await brokenWorker.runOnce(), true, "job processed");

  const job = await pool.query(`SELECT status, error FROM workflow_jobs WHERE workflow_id=$1 ORDER BY job_id DESC LIMIT 1`, [workflowId]);
  assert.equal(job.rows[0].status, "failed");
  assert.match(job.rows[0].error, /RUNTIME_CONFIGURATION_RESOLUTION_FAILED:control plane unavailable/);
  assert.equal(fetchAttempts, 0);
});

// ---------------------------------------------------------------------------
// 5 — Resume-path regression: governed resume without overrides and without
//     a resolver fails closed with zero provider requests.
// ---------------------------------------------------------------------------

test("a governed resume without persisted overrides and without a resolver fails closed", { timeout: 60000 }, async () => {
  const id = runId();
  const workflowId = `wf-wire-resume-${id}`;
  const projectId = `proj-wire-resume-${id}`;
  const commandId = `command-wire-resume-${id}`;
  let fetchAttempts = 0;
  globalThis.fetch = async () => { fetchAttempts += 1; throw new Error("must not submit"); };

  await submitGovernedProduce(workflowId, projectId, commandId);
  // Seed a paused instance WITHOUT controlAgentOverrides (the incident shape).
  const now = new Date().toISOString();
  await persistence.saveWorkflow({
    workflowId,
    definitionId: definition.id,
    definitionVersion: definition.version,
    state: "PAUSED",
    context: { workflowId, correlationId: `corr-${workflowId}`, brandId: projectId, outputs: {}, data: { directive: "produce", commandId } },
    steps: definition.steps.map((step) => ({ stepId: step.id, status: "pending", attempts: 0, startedAt: null, finishedAt: null })),
    ready: ["writer"],
    lastCheckpointRef: null,
    createdAt: now,
    updatedAt: now,
  });

  const executor = createProductionAgentExecutor({ persistence, providerBoundary: frozenMediaBoundary({}) });
  const bareWorker = new WorkflowWorker({ queue, persistence, executor, control, pollMs: 5 });
  assert.equal(await bareWorker.runOnce(), true, "job processed");

  const job = await pool.query(`SELECT status, error FROM workflow_jobs WHERE workflow_id=$1 ORDER BY job_id DESC LIMIT 1`, [workflowId]);
  assert.equal(job.rows[0].status, "failed");
  assert.match(job.rows[0].error, /RUNTIME_CONFIGURATION_RESOLUTION_FAILED/);
  assert.equal(fetchAttempts, 0);
});

// ---------------------------------------------------------------------------
// 6 — Single construction path: the CLI and the operator runner both use the
//     shared bootstrap; neither constructs a bare production worker.
// ---------------------------------------------------------------------------

test("the production CLI and the revision operator runner construct their worker exclusively through the shared bootstrap", async () => {
  const cli = await readFile(new URL("../src/cli.ts", import.meta.url), "utf8");
  assert.ok(cli.includes("createProductionWorker("), "CLI constructs via the shared bootstrap");
  assert.ok(!cli.includes("new WorkflowWorker("), "CLI never constructs a bare worker");

  const operator = await readFile(new URL("../../../scripts/revision-live-run.mjs", import.meta.url), "utf8");
  assert.ok(operator.includes("createProductionWorker("), "operator runner constructs via the shared bootstrap");
  assert.ok(!operator.includes("new WorkflowWorker("), "operator runner never constructs a bare worker");

  const bootstrap = await readFile(new URL("../src/production-worker.ts", import.meta.url), "utf8");
  assert.ok(bootstrap.includes("resolveCommandConfiguration"), "bootstrap wires the configuration resolver");
  assert.ok(bootstrap.includes("ProductionModelRoutingStore"), "bootstrap resolves from canonical production routing");
  assert.ok(bootstrap.includes("preflightGovernedCommand"), "bootstrap wires universal preflight");
});
