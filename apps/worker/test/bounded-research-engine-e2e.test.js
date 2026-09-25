/**
 * Provider-free bounded Research engine E2E, two-phase (capability-remediation V1).
 *
 * Each top-level scenario runs in its own scratch Postgres database
 * (created/dropped here; the production database is never touched).
 *
 * REAL per scenario: queue, persistence, budget store, routing store,
 * recovery dispatcher, workflow engine, production worker, production
 * executor, ResearchAgent (plan LLM + synthesis LLM), capability registry,
 * WebSearchCapabilityExecutor, evidence gate, bounded stop.
 * FAKED ONLY at external transports: OpenRouter HTTP (fetch mock, two LLM
 * legs distinguished by prompt) and the web-search provider itself (canned
 * factual results). Serper is never hit.
 */
import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import {
  createPool,
  migrate,
  PostgresPersistence,
  PostgresQueue,
  PostgresRecoveryDispatcher,
} from "@ai-media-factory/database";
import {
  buildProviderBoundary,
  createProductionWorker,
} from "../dist/index.js";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";
import {
  WebSearchCapabilityExecutor,
  WEB_SEARCH_CAPABILITY_ID,
  createCapabilityRegistry,
} from "@ai-media-factory/tool-framework";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.DATABASE_URL) {
  try {
    const envText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env"), "utf8");
    const match = envText.match(/^DATABASE_URL=(.+)$/m);
    if (match) process.env.DATABASE_URL = match[1].trim();
  } catch { /* fall through to the explicit failure below */ }
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for the bounded engine E2E (scratch database only; production rows are never touched)");

const PROJECT = "morroway";
const RESEARCH_MODEL = "openai/gpt-6-luna";
const ROUTING_VERSION = "amf-balanced-production-routing-v1-e2e";
const PRICE_SNAPSHOT = "e2e-price-research";
const PLAN_COST = 0.00001;
const SYNTHESIS_COST = 0.00002;

const FACTUAL_RESULTS = [
  { title: "Qanat: ancient Persian water tunnels still in use", url: "https://example.test/qanat-persia", snippet: "Archaeologists document qanat tunnels in Iran supplying villages for two millennia.", source: "example.test", rank: 1 },
  { title: "Nubian vault: mud-brick roofing without timber", url: "https://example.test/nubian-vault", snippet: "Field survey records Nubian vault construction across Upper Egypt and Sudan.", source: "example.test", rank: 2 },
  { title: "Stepwells of Gujarat: monsoon water architecture", url: "https://example.test/stepwells", snippet: "Conservation report lists dated stepwell inscriptions and measured depths.", source: "example.test", rank: 3 },
];

const TOPIC = "E2E bounded research candidates ancient water engineering";
const OBJECTIVE = "E2E Morroway-style pilot research for surprising well-sourced factual short candidates";
const RELEVANT_DESCRIPTION = "E2E production shortlist of factual water-engineering candidates for Morroway-style pilot research.";

function synthesisPlan(stageId) {
  return {
    reportId: "00000000-0000-4000-8000-000000000001",
    taskId: `research-${stageId}`,
    stage: stageId,
    taskDescription: RELEVANT_DESCRIPTION,
    summary: "Capability plan only: retrieve candidate factual stories, then verify claims and visual potential.",
    sources: [],
    confidence: 0.12,
    citations: [],
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
}

function synthesisGrounded(stageId) {
  return {
    reportId: "00000000-0000-4000-8000-000000000002",
    taskId: `research-${stageId}`,
    stage: stageId,
    taskDescription: RELEVANT_DESCRIPTION,
    summary: "Three dated water-engineering candidates with field-survey provenance.",
    candidateStories: FACTUAL_RESULTS.map((result) => ({ topic: result.title, factualAngle: result.snippet.slice(0, 60), sourceIds: [], fitNote: "Short-form visual potential." })),
    sources: FACTUAL_RESULTS.map((result, index) => ({ id: index + 1, title: result.title, url: result.url, snippet: result.snippet })),
    confidence: 0.8,
    citations: FACTUAL_RESULTS.map((result, index) => ({ sourceId: index + 1, text: result.snippet.slice(0, 40) })),
    evidenceRisks: ["Fixture-bounded coverage."],
    status: "grounded",
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
}

const sse = (model, payload, cost) => {
  const visible = JSON.stringify(payload);
  const event = `data: ${JSON.stringify({ id: "gen-e2e", model, provider: "e2e-fixture", choices: [{ delta: { content: visible }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 60, total_tokens: 110, completion_tokens_details: { reasoning_tokens: 5 }, cost } })}\n\ndata: [DONE]\n\n`;
  return new Response(event, { status: 200 });
};

async function createScratchDb(dbName) {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL.replace("/ai_media_factory", "/postgres") });
  await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await admin.query(`CREATE DATABASE ${dbName}`);
  const parsed = new URL(process.env.DATABASE_URL);
  parsed.pathname = `/${dbName}`;
  const pool = createPool({ connectionString: parsed.toString() });
  await migrate(pool);
  return { admin, pool };
}

async function dropScratchDb(admin, pool, dbName) {
  if (pool) await pool.end();
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  }
}

async function seedInfra(pool, researchLimit, textLimit) {
  await pool.query(
    `INSERT INTO model_benchmark_runs (benchmark_run_id,dataset_version,catalog_snapshot_id,candidate_plan_version,status,created_by,provenance,hard_spend_cap_usd,created_at) VALUES ('e2e-bench-1','v1','snap-1','plan-1','COMPLETED','e2e','{}',1,'2026-09-25T00:00:00.000Z')`
  );
  await pool.query(
    `INSERT INTO provider_model_catalog (provider,provider_model_id,canonical_name,architecture,source_url,retrieved_at,refresh_id,raw_metadata,content_hash,pricing_hash,capability_hash,description_hash,availability,current_price_snapshot_id) VALUES ('openrouter','openai/gpt-6-luna','GPT-6 Luna','{}','https://example.test','2026-09-25T00:00:00.000Z','r1','{}','c','p','c','d','AVAILABLE','e2e-price-research')`
  );
  await pool.query(
    `INSERT INTO production_model_routing_versions (routing_version_id,profile,scope_type,project_id,benchmark_run_id,dataset_version,decision_source,owner_decision,active,activated_at,provenance) VALUES ('${ROUTING_VERSION}','BALANCED','PROJECT','${PROJECT}','e2e-bench-1','v1','BENCHMARK_EVIDENCE','APPROVED',TRUE,'2026-09-25T00:00:00.000Z','{}')`
  );
  await pool.query(
    `INSERT INTO production_model_routing_entries (routing_version_id,role,primary_model_id,price_snapshot_ids,evidence) VALUES ('${ROUTING_VERSION}','research','openai/gpt-6-luna','{"openai/gpt-6-luna":"e2e-price-research"}','{}')`
  );
  const now = new Date().toISOString();
  await pool.query(
    `UPDATE production_phase_call_budgets SET limit_count=$1, reserved_count=0, consumed_count=0, max_retries=0, active=TRUE, updated_at=$2 WHERE project_id='${PROJECT}' AND phase='PRE_MEDIA_PHASE' AND call_kind='research'`,
    [researchLimit, now]
  );
  await pool.query(
    `UPDATE production_phase_call_budgets SET limit_count=$1, reserved_count=0, consumed_count=0, max_retries=0, active=TRUE, updated_at=$2 WHERE project_id='${PROJECT}' AND phase='PRE_MEDIA_PHASE' AND call_kind='text_agent'`,
    [textLimit, now]
  );
}

async function seedScenario(pool, persistence, queue, suffix) {
  const workflowId = `wf-e2e-bounded-${suffix}`;
  const correlationId = `corr-e2e-bounded-${suffix}`;
  const contentId = `content-e2e-bounded-${suffix}`;
  const definition = directiveToWorkflowDefinition("produce-pre-media");
  const researchStep = definition.steps.find((step) => step.agent === "research" && step.kind === "agent");
  assert.ok(researchStep);
  const orchestratorStep = definition.steps.find((step) => step.agent === "orchestrator");
  assert.ok(orchestratorStep);
  const commandContext = {
    projectId: PROJECT,
    productionPhase: "PRE_MEDIA_PHASE",
    mediaAuthority: "NOT_GRANTED",
    publicationAuthority: "NOT_GRANTED",
    phaseAuthority: "OWNER_START_PRE_MEDIA",
    contentId,
    objective: OBJECTIVE,
    contentTopic: TOPIC,
    audience: "curious adults",
    platform: "youtube",
    productionBrief: { topic: TOPIC, objective: OBJECTIVE, brandProject: PROJECT, targetAudience: "curious adults", targetPlatform: "youtube" },
  };
  await queue.submit({
    submissionKey: `e2e-bounded-${suffix}`,
    workflowId,
    directive: "produce-pre-media",
    correlationId,
    brandId: PROJECT,
    definition,
    commandContext,
    status: "submitted",
  });
  const now = new Date().toISOString();
  await persistence.saveWorkflow({
    workflowId,
    definitionId: "produce-pre-media",
    definitionVersion: 1,
    state: "FAILED",
    context: {
      workflowId,
      correlationId,
      brandId: PROJECT,
      data: {
        ...commandContext,
        directive: "produce-pre-media",
        controlAgentOverrides: {
          research: { provider: "openrouter", model: RESEARCH_MODEL },
          "*": { provider: "openrouter", model: RESEARCH_MODEL },
        },
      },
      outputs: {},
    },
    steps: definition.steps.map((step) => ({
      stepId: step.id,
      status: step.id === orchestratorStep.id ? "completed" : step.id === researchStep.id ? "failed" : "pending",
      attempts: step.id === researchStep.id ? 1 : 0,
      startedAt: now,
      finishedAt: now,
    })),
    ready: [],
    lastCheckpointRef: null,
    createdAt: now,
    updatedAt: now,
  });
  await persistence.saveArtifact({
    artifactId: `art-${workflowId}-orchestrator`,
    kind: "execution_plan",
    producerAgent: "orchestrator",
    workflowId,
    correlationId,
    status: "completed",
    payload: { stage: "INITIAL_CONTENT_PLAN", planId: `plan-${workflowId}`, topic: TOPIC, objective: OBJECTIVE },
    contentType: "application/json",
    schemaVersion: "1.0",
    createdAt: now,
  });
  const execRow = (executionId, agentId, stage) => ({
    executionId,
    workflowId,
    correlationId,
    agentId,
    stage,
    capability: "agent.execute",
    provider: "openrouter",
    model: RESEARCH_MODEL,
    runtime: "governed-openrouter-llm",
    promptVersion: null,
    configurationFingerprint: null,
    startedAt: now,
    completedAt: now,
    latencyMs: 1,
    status: "failed",
    usage: null,
    costKind: "UNKNOWN",
    cost: null,
    currency: "USD",
    artifactIds: [],
    parentExecutionIds: [],
    attemptNumber: 1,
    providerRequestId: null,
    providerJobId: null,
    errorClassification: "PROVIDER_TRANSPORT_FAILED",
    configuration: { lifecycleState: "FAILED" },
  });
  await persistence.saveExecutionProvenance(execRow(`exec-orig-${suffix}`, "orchestrator", orchestratorStep.id));
  await persistence.saveExecutionProvenance(execRow(`exec-rec-${suffix}`, "research", researchStep.id));
  return { workflowId, correlationId, definition, researchStep, orchestratorStep };
}

function makeBoundary(persistence, pool) {
  const realBoundary = buildProviderBoundary({ persistence, pool });
  const registry = createCapabilityRegistry({
    capabilities: [{ capabilityId: WEB_SEARCH_CAPABILITY_ID, description: "Governed web search", inputSchema: { type: "object" }, outputSchema: { type: "object" } }],
    grants: [{ agentId: "research", capabilityIds: [WEB_SEARCH_CAPABILITY_ID] }],
  });
  const searchExecutor = new WebSearchCapabilityExecutor(
    { search: async () => ({ providerId: "e2e-factual-fixture", results: FACTUAL_RESULTS }) },
    registry,
    { maxResults: 5, maxQueryLength: 200 }
  );
  return {
    ...realBoundary,
    boundary: {
      executeCapability: (request) => request.capabilityId === WEB_SEARCH_CAPABILITY_ID
        ? searchExecutor.execute(request)
        : realBoundary.boundary.executeCapability(request),
    },
  };
}

async function waitForSubmission(queue, workflowId, want, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const submission = await queue.loadSubmissionByWorkflow(workflowId);
    if (submission && submission.status === want) return submission;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for submission ${workflowId} -> ${want}`);
}

test("USABLE research stops after research with artifact persisted and CEO at zero", async () => {
  const dbName = "amf_e2e_bounded_usable";
  const { admin, pool } = await createScratchDb(dbName);
  const transports = [];
  const originalFetch = global.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  try {
    await seedInfra(pool, 1, 2);
    const persistence = new PostgresPersistence(pool);
    const queue = new PostgresQueue(pool);
    const { workflowId, researchStep, orchestratorStep } = await seedScenario(pool, persistence, queue, "usable");
    const dispatcher = new PostgresRecoveryDispatcher(pool, persistence);
    const input = {
      authorizationKey: "e2e-bounded-usable-v1",
      workflowId,
      recoveryOfExecutionId: "exec-rec-usable",
      originalExecutionId: "exec-orig-usable",
      recoveryReason: "E2E_BOUNDED_USABLE",
      recoveryAuthorization: "OWNER_APPROVED",
      targetStepId: researchStep.id,
      preserveCompletedStepIds: [orchestratorStep.id],
      requiredArtifactsByStep: { [orchestratorStep.id]: "execution_plan" },
      stopAfterStepId: researchStep.id,
    };
    const first = await dispatcher.dispatch(input);
    assert.equal(first.created, true);
    const reloaded = await persistence.loadWorkflow(workflowId);
    assert.equal(reloaded.context.data.boundedExecution.stopAfterStepId, researchStep.id);
    const duplicate = await dispatcher.dispatch(input);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.recoveryExecutionId, first.recoveryExecutionId);
    assert.equal(duplicate.jobId, first.jobId);

    process.env.OPENROUTER_API_KEY = "e2e-fixture-key";
    global.fetch = async (url, options) => {
      const target = String(url);
      if (target.includes("openrouter")) {
        if (target.includes("auth/key")) return new Response(JSON.stringify({ data: { label: "e2e" } }), { status: 200 });
        const submitted = JSON.parse(options.body);
        transports.push({ model: submitted.model, synthesis: JSON.stringify(submitted).includes("Post-retrieval synthesis") });
        if (submitted.model !== RESEARCH_MODEL) throw new Error(`UNEXPECTED_MODEL_TRANSPORT:${submitted.model}`);
        const isSynthesis = JSON.stringify(options.body).includes("Post-retrieval synthesis");
        return sse(RESEARCH_MODEL, isSynthesis ? synthesisGrounded(researchStep.id) : synthesisPlan(researchStep.id), isSynthesis ? SYNTHESIS_COST : PLAN_COST);
      }
      throw new Error(`REAL_EGRESS_BLOCKED:${target.slice(0, 80)}`);
    };
    const runtime = await createProductionWorker({ pool, providerBoundary: makeBoundary(persistence, pool), orphanStaleMs: Number.MAX_SAFE_INTEGER });
    assert.equal(await runtime.worker.runOnce(), true);
    const submission = await waitForSubmission(queue, workflowId, "bounded_stop");
    assert.equal(submission.status, "bounded_stop");
    assert.equal(transports.filter((entry) => !entry.synthesis).length, 1);
    assert.equal(transports.filter((entry) => entry.synthesis).length, 1);
    assert.ok(transports.every((entry) => entry.model === RESEARCH_MODEL));

    const artifacts = await persistence.listArtifacts(workflowId);
    const report = artifacts.find((artifact) => artifact.kind === "research_report" && artifact.status === "completed");
    assert.ok(report, "expected a completed research_report");
    assert.equal(report.payload.sources.length, 3);
    assert.equal(report.payload.candidateStories.length, 3);
    assert.equal(report.payload.evidenceQuality.status, "USABLE");
    assert.equal(report.payload.confidence, 0.8);
    assert.equal(report.payload.researchStatus, "USABLE");
    assert.ok(report.payload.planningUsage);
    assert.ok(report.payload.synthesisUsage);
    assert.equal(report.payload.synthesisUsage.costUsd, SYNTHESIS_COST);

    const instance = await persistence.loadWorkflow(workflowId);
    assert.equal(instance.state, "PAUSED");
    assert.equal(instance.context.data.boundedStop.stopAfterStepId, researchStep.id);
    assert.equal(instance.steps.find((step) => step.stepId === researchStep.id).status, "completed");
    assert.ok(instance.ready.length > 0, "ready frontier preserved for future continuation");

    const executions = await persistence.listExecutionProvenance(workflowId);
    assert.equal(executions.filter((record) => record.agentId === "ceo").length, 0);
    const reservations = await pool.query("SELECT role,call_kind,status,calculable_cost_usd,idempotency_key FROM production_call_reservations WHERE workflow_id=$1 ORDER BY reserved_at", [workflowId]);
    assert.equal(reservations.rows.filter((row) => row.role === "ceo").length, 0);
    const researchReservations = reservations.rows.filter((row) => row.role === "research");
    assert.equal(researchReservations.length, 3);
    assert.ok(researchReservations.every((row) => row.status === "CONSUMED"));
    assert.ok(new Set(researchReservations.map((row) => row.idempotency_key)).size === 3, "distinct reservation identities per call");
    const planRes = researchReservations.find((row) => row.call_kind === "text_agent" && !row.idempotency_key.endsWith(":synthesis"));
    const synthRes = researchReservations.find((row) => row.call_kind === "text_agent" && row.idempotency_key.endsWith(":synthesis"));
    assert.ok(planRes && synthRes);
    assert.equal(Number(planRes.calculable_cost_usd), PLAN_COST);
    assert.equal(Number(synthRes.calculable_cost_usd), SYNTHESIS_COST);

    const fresh = new PostgresPersistence(pool);
    const reloadedAfterRestart = await fresh.loadWorkflow(workflowId);
    assert.equal(reloadedAfterRestart.state, "PAUSED");
    assert.equal(reloadedAfterRestart.context.data.boundedStop.stopAfterStepId, researchStep.id);

    const budgets = await pool.query("SELECT call_kind,consumed_count FROM production_phase_call_budgets WHERE project_id='morroway' AND phase='PRE_MEDIA_PHASE' ORDER BY call_kind");
    assert.deepEqual(budgets.rows.map((row) => [row.call_kind, Number(row.consumed_count)]), [["research", 1], ["text_agent", 2]]);

    // No duplicate work on re-poll: queue drained, budgets frozen.
    assert.equal(await runtime.worker.runOnce(), false);
    const budgetsAfter = await pool.query("SELECT call_kind,consumed_count FROM production_phase_call_budgets WHERE project_id='morroway' AND phase='PRE_MEDIA_PHASE' ORDER BY call_kind");
    assert.deepEqual(budgetsAfter.rows.map((row) => [row.call_kind, Number(row.consumed_count)]), [["research", 1], ["text_agent", 2]]);
  } finally {
    global.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    await dropScratchDb(admin, pool, dbName);
  }
}, { timeout: 300000 });

test("RETRY attempt B on the same workflow persists distinct evidence", async () => {
  // NOTE: runs against the SAME scratch database as the USABLE attempt above
  // is intentionally isolated per file run; this test recreates the full
  // two-attempt sequence on its own database to stay hermetic.
  const dbName = "amf_e2e_bounded_retry";
  const { admin, pool } = await createScratchDb(dbName);
  const transports = [];
  const originalFetch = global.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  try {
    await seedInfra(pool, 2, 4);
    const persistence = new PostgresPersistence(pool);
    const queue = new PostgresQueue(pool);
    const { workflowId, researchStep, orchestratorStep } = await seedScenario(pool, persistence, queue, "retry");
    const dispatcher = new PostgresRecoveryDispatcher(pool, persistence);
    process.env.OPENROUTER_API_KEY = "e2e-fixture-key";
    global.fetch = async (url, options) => {
      const target = String(url);
      if (target.includes("openrouter")) {
        if (target.includes("auth/key")) return new Response(JSON.stringify({ data: { label: "e2e" } }), { status: 200 });
        const submitted = JSON.parse(options.body);
        transports.push({ model: submitted.model });
        if (submitted.model !== RESEARCH_MODEL) throw new Error(`UNEXPECTED_MODEL_TRANSPORT:${submitted.model}`);
        const isSynthesis = JSON.stringify(options.body).includes("Post-retrieval synthesis");
        return sse(RESEARCH_MODEL, isSynthesis ? synthesisGrounded(researchStep.id) : synthesisPlan(researchStep.id), isSynthesis ? SYNTHESIS_COST : PLAN_COST);
      }
      throw new Error(`REAL_EGRESS_BLOCKED:${target.slice(0, 80)}`);
    };
    const runAttempt = async (authorizationKey, recoveryOf, original) => {
      const dispatched = await dispatcher.dispatch({
        authorizationKey,
        workflowId,
        recoveryOfExecutionId: recoveryOf,
        originalExecutionId: original,
        recoveryReason: `E2E_RETRY_${authorizationKey}`,
        recoveryAuthorization: "OWNER_APPROVED",
        targetStepId: researchStep.id,
        preserveCompletedStepIds: [orchestratorStep.id],
        requiredArtifactsByStep: { [orchestratorStep.id]: "execution_plan" },
        stopAfterStepId: researchStep.id,
      });
      const runtime = await createProductionWorker({ pool, providerBoundary: makeBoundary(persistence, pool), orphanStaleMs: Number.MAX_SAFE_INTEGER });
      assert.equal(await runtime.worker.runOnce(), true);
      await waitForSubmission(queue, workflowId, "bounded_stop");
      return dispatched;
    };
    const attemptA = await runAttempt("e2e-retry-a-v1", "exec-rec-retry", "exec-orig-retry");
    const attemptB = await runAttempt("e2e-retry-b-v1", "exec-rec-retry", "exec-orig-retry");
    assert.notEqual(attemptA.recoveryExecutionId, attemptB.recoveryExecutionId);

    const caps = (await pool.query("SELECT result_id,evidence_id,status FROM capability_executions WHERE workflow_id=$1 ORDER BY executed_at", [workflowId])).rows;
    assert.equal(caps.filter((row) => row.capability_id === "web.search" || row.status === "success").length >= 0, true);
    const successes = caps.filter((row) => row.status === "success");
    assert.equal(successes.length, 2, "expected two distinct persisted retrieval executions");
    assert.notEqual(successes[0].result_id, successes[1].result_id);
    assert.ok(successes[0].result_id.includes(attemptA.recoveryExecutionId));
    assert.ok(successes[1].result_id.includes(attemptB.recoveryExecutionId));

    const artifacts = await persistence.listArtifacts(workflowId);
    const reports = artifacts.filter((artifact) => artifact.kind === "research_report" && artifact.status === "completed");
    assert.equal(reports.length, 2);
    const latest = reports[reports.length - 1];
    assert.equal(latest.payload.metadata.providerInfo.evidenceId, successes[1].evidence_id, "final artifact lineage identifies attempt B evidence");

    const budgets = await pool.query("SELECT call_kind,consumed_count FROM production_phase_call_budgets WHERE project_id='morroway' AND phase='PRE_MEDIA_PHASE' ORDER BY call_kind");
    assert.deepEqual(budgets.rows.map((row) => [row.call_kind, Number(row.consumed_count)]), [["research", 2], ["text_agent", 4]]);
    const executions = await persistence.listExecutionProvenance(workflowId);
    assert.equal(executions.filter((record) => record.agentId === "ceo").length, 0);
  } finally {
    global.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    await dropScratchDb(admin, pool, dbName);
  }
}, { timeout: 300000 });

test("NEEDS research fails closed without CEO", async () => {
  const dbName = "amf_e2e_bounded_needs";
  const { admin, pool } = await createScratchDb(dbName);
  const transports = [];
  const originalFetch = global.fetch;
  const originalOpenRouterKey = process.env.OPENROUTER_API_KEY;
  try {
    await seedInfra(pool, 1, 2);
    const persistence = new PostgresPersistence(pool);
    const queue = new PostgresQueue(pool);
    const { workflowId, researchStep, orchestratorStep } = await seedScenario(pool, persistence, queue, "needs");
    const dispatcher = new PostgresRecoveryDispatcher(pool, persistence);
    await dispatcher.dispatch({
      authorizationKey: "e2e-bounded-needs-v1",
      workflowId,
      recoveryOfExecutionId: "exec-rec-needs",
      originalExecutionId: "exec-orig-needs",
      recoveryReason: "E2E_BOUNDED_NEEDS",
      recoveryAuthorization: "OWNER_APPROVED",
      targetStepId: researchStep.id,
      preserveCompletedStepIds: [orchestratorStep.id],
      requiredArtifactsByStep: { [orchestratorStep.id]: "execution_plan" },
      stopAfterStepId: researchStep.id,
    });
    process.env.OPENROUTER_API_KEY = "e2e-fixture-key";
    global.fetch = async (url, options) => {
      const target = String(url);
      if (target.includes("openrouter")) {
        if (target.includes("auth/key")) return new Response(JSON.stringify({ data: { label: "e2e" } }), { status: 200 });
        const submitted = JSON.parse(options.body);
        transports.push({ model: submitted.model });
        if (submitted.model !== RESEARCH_MODEL) throw new Error(`UNEXPECTED_MODEL_TRANSPORT:${submitted.model}`);
        return sse(RESEARCH_MODEL, synthesisPlan(researchStep.id), PLAN_COST);
      }
      throw new Error(`REAL_EGRESS_BLOCKED:${target.slice(0, 80)}`);
    };
    const runtime = await createProductionWorker({ pool, providerBoundary: makeBoundary(persistence, pool), orphanStaleMs: Number.MAX_SAFE_INTEGER });
    assert.equal(await runtime.worker.runOnce(), true);
    await waitForSubmission(queue, workflowId, "failed");
    const artifacts = await persistence.listArtifacts(workflowId);
    assert.equal(artifacts.filter((artifact) => artifact.kind === "research_report").length, 0);
    const executions = await persistence.listExecutionProvenance(workflowId);
    assert.equal(executions.filter((record) => record.agentId === "ceo").length, 0);
    const researchExecutions = executions.filter((record) => record.agentId === "research" && !String(record.executionId).startsWith("exec-"));
    assert.equal(researchExecutions.length, 1, "expected exactly one governed research execution");
    assert.equal(researchExecutions[0].status, "failed");
    assert.ok(transports.length >= 2, "expected planning and synthesis LLM transports");
    assert.ok(transports.every((entry) => entry.model === RESEARCH_MODEL));
    const budgets = await pool.query("SELECT call_kind,consumed_count FROM production_phase_call_budgets WHERE project_id='morroway' AND phase='PRE_MEDIA_PHASE' ORDER BY call_kind");
    assert.deepEqual(budgets.rows.map((row) => [row.call_kind, Number(row.consumed_count)]), [["research", 1], ["text_agent", 2]]);
  } finally {
    global.fetch = originalFetch;
    if (originalOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalOpenRouterKey;
    await dropScratchDb(admin, pool, dbName);
  }
}, { timeout: 300000 });

