/**
 * Provider-free E2E for Research synthesis submission lifecycle hardening
 * (AMF_RESEARCH_EVIDENCE_GATE_AND_SYNTHESIS_LIFECYCLE_HARDENING_V1, Part C/D).
 *
 * Each scenario runs in its own scratch Postgres database (created/dropped
 * here; production is never touched). REAL per scenario: queue, persistence,
 * budget store, routing store (with BOTH the research role route Luna and the
 * research-synthesis leg route Nemo), recovery dispatcher, production worker,
 * production executor, ResearchAgent, capability registry, evidence gate.
 * FAKED ONLY at external transports: OpenRouter HTTP (fetch mock, legs
 * distinguished by submitted model + prompt) and web-search (canned results).
 *
 * Cases: 4 = valid Nemo synthesis CONSUMED with exact Nemo accounting;
 * Canary-09 mirror = retrieval success + insufficient synthesis -> blocked
 * with durable researchBlocked diagnostics and FAILED_AFTER_SUBMISSION
 * (submitted, never RELEASED); 1 = pre-submission failure -> RELEASED with
 * zero Nemo transport; 2 = Nemo transport failure -> submitted failure;
 * 3 = Nemo validation failure -> FAILED_AFTER_SUBMISSION + STRUCTURAL.
 */
import test from "node:test";
import assert, { strictEqual } from "node:assert/strict";
import pg from "pg";
import {
  createPool,
  migrate,
  PostgresPersistence,
  PostgresQueue,
  PostgresRecoveryDispatcher,
  ProductionCallBudgetStore,
} from "@ai-media-factory/database";
import { createProductionWorker } from "../dist/index.js";
import { directiveToWorkflowDefinition } from "@ai-media-factory/orchestrator";
import {
  WebSearchCapabilityExecutor,
  WEB_SEARCH_CAPABILITY_ID,
  createCapabilityRegistry,
} from "@ai-media-factory/tool-framework";
import { buildProviderBoundary } from "../dist/index.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const originalSandboxNetworkMarker = process.env.CODEX_SANDBOX_NETWORK_DISABLED;
delete process.env.CODEX_SANDBOX_NETWORK_DISABLED;
test.after(() => {
  if (originalSandboxNetworkMarker === undefined) delete process.env.CODEX_SANDBOX_NETWORK_DISABLED;
  else process.env.CODEX_SANDBOX_NETWORK_DISABLED = originalSandboxNetworkMarker;
});

if (!process.env.DATABASE_URL) {
  try {
    const envText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".env"), "utf8");
    const match = envText.match(/^DATABASE_URL=(.+)$/m);
    if (match) process.env.DATABASE_URL = match[1].trim();
  } catch { /* fall through */ }
}
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required (scratch databases only)");

const PROJECT = "morroway";
const LUNA = "openai/gpt-6-luna";
const NEMO = "mistralai/mistral-nemo";
const ROUTING_VERSION = "amf-leg-routing-hardening-e2e-v1";
const PRICE_LUNA = "e2e-price-luna";
const PRICE_NEMO = "e2e-price-nemo";
const PLAN_COST = 0.00001;
const SYNTHESIS_COST = 0.00002;

const FACTUAL_RESULTS = [
  { title: "Qanat: Persian water management", url: "https://www.si.edu/spotlight/qanat-water", snippet: "Smithsonian survey of qanat tunnel systems in Iran with measured plans.", source: "si.edu", rank: 1 },
  { title: "Qanat | irrigation | Britannica", url: "https://www.britannica.com/technology/qanat", snippet: "Qanat, ancient irrigation tunnel system of Iran with vertical shafts.", source: "britannica.com", rank: 2 },
  { title: "Stepwells of Gujarat: monsoon water architecture", url: "https://example.test/stepwells", snippet: "Conservation report lists dated stepwell inscriptions and measured depths.", source: "example.test", rank: 3 },
];

const TOPIC = "E2E synthesis lifecycle ancient water engineering";
const OBJECTIVE = "E2E per-leg synthesis lifecycle proof with canned retrieval";
const RELEVANT_DESCRIPTION = "E2E production shortlist of factual water-engineering candidates.";

function synthesisPlan(stageId) {
  return {
    reportId: "00000000-0000-4000-8000-000000000001",
    taskId: `research-${stageId}`,
    stage: stageId,
    taskDescription: RELEVANT_DESCRIPTION,
    summary: "Capability plan only: retrieve candidate factual stories, then verify claims and visual potential.",
    candidateStories: [],
    sources: [],
    confidence: 0.12,
    citations: [],
    evidenceRisks: [],
    status: "insufficient_evidence",
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
    candidateStories: [{
      candidateId: "candidate-1",
      topic: "Qanat water tunnels of Persia",
      factualAngle: "Two-millennia-old underground water engineering",
      keyClaims: ["Qanat tunnels convey groundwater across arid Iran"],
      sourceIds: [1, 2],
      supportingEvidenceIds: [1, 2],
      sourceQualitySummary: "Institutional survey plus reputable reference",
      visualPotential: "Tunnel cross-sections and shaft grids",
      shortFormPotential: "30-second reveal",
      evidenceRisks: ["Dating precision varies by site"],
      verificationStatus: "needs-verification",
    }],
    sources: FACTUAL_RESULTS.map((result, index) => ({ id: index + 1, title: result.title, url: result.url, snippet: result.snippet })),
    confidence: 0.8,
    citations: FACTUAL_RESULTS.map((result, index) => ({ sourceId: index + 1, text: result.snippet.slice(0, 40) })),
    evidenceRisks: ["Fixture-bounded coverage."],
    status: "grounded",
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
}

function v2Mission(stageId) {
  return {
    taskId: `research-${stageId}`, stage: stageId, missionId: `mission-${stageId}`, objective: OBJECTIVE,
    market: null, geography: null, language: "English", platforms: ["YouTube Shorts"],
    contentPillar: "Historical POV", factualMode: "HISTORICAL_POV", audience: "curious adults", trendMode: "HYBRID",
    timeHorizon: { from: null, to: null }, currentDate: "2026-09-25",
    discoveryLanes: [
      { laneId: "HISTORICAL_OPPORTUNITY", purpose: "Find named factual candidates", queryGuidance: "museum documented ancient water engineering", desiredCapability: "WEB_SEARCH", actualCapability: "web.search", maxCalls: 1, expectedOutput: "sources" },
    ],
    desiredSourceTypes: ["WEB_SEARCH"], availableCapabilities: [], unavailableDesiredCapabilities: [],
    searchPriorities: ["named candidates"], verificationRequirements: ["institutional corroboration"], stopConditions: ["bounded calls"], riskNotes: [],
  };
}

function v2Insufficient(stageId) {
  return {
    ...synthesisGrounded(stageId),
    candidateStories: [],
    confidence: 0.3,
    evidenceRisks: ["No candidate met the verification rule"],
    status: "insufficient_evidence",
  };
}

const sse = (model, payload, cost) => {
  const visible = JSON.stringify(payload);
  const event = `data: ${JSON.stringify({ id: "gen-e2e", model, provider: "e2e-fixture", choices: [{ delta: { content: visible }, finish_reason: "stop" }], usage: { prompt_tokens: 50, completion_tokens: 60, total_tokens: 110, completion_tokens_details: { reasoning_tokens: 5 }, cost } })}\n\ndata: [DONE]\n\n`;
  return new Response(event, { status: 200 });
};

async function createScratchDb(dbName) {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL.replace("/ai_media_factory", "/postgres") });
  await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [dbName]);
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
    await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [dbName]);
    await admin.query(`DROP DATABASE IF EXISTS ${dbName}`);
    await admin.end();
  }
}

async function seedInfra(pool, researchLimit, textLimit) {
  const now = new Date().toISOString();
  await pool.query(
    `INSERT INTO model_benchmark_runs (benchmark_run_id,dataset_version,catalog_snapshot_id,candidate_plan_version,status,created_by,provenance,hard_spend_cap_usd,created_at) VALUES ('e2e-bench-leg-1','v1','snap-1','plan-1','COMPLETED','e2e','{}',1,'2026-09-25T00:00:00.000Z')`
  );
  for (const [snapshot, model] of [[PRICE_LUNA, LUNA], [PRICE_NEMO, NEMO]]) {
    await pool.query(
      `INSERT INTO provider_model_price_snapshots (price_snapshot_id,provider,provider_model_id,refresh_id,retrieved_at,pricing_raw,pricing_normalized,pricing_hash) VALUES ($1,'openrouter',$2,'r1',$3,'{}','{}','p')`,
      [snapshot, model, now]
    );
    await pool.query(
      `INSERT INTO provider_model_catalog (provider,provider_model_id,canonical_name,context_length,architecture,input_modalities,output_modalities,supported_parameters,capabilities,source_url,retrieved_at,refresh_id,raw_metadata,content_hash,pricing_hash,capability_hash,description_hash,availability,current_price_snapshot_id) VALUES ('openrouter',$1,'E2E model',32768,'{}','["text"]','["text"]','["response_format"]','{"structuredOutput":true}','https://example.test',$2,'r1','{"top_provider":{"max_completion_tokens":8192}}','c','p','c','d','AVAILABLE',$3)`,
      [model, now, snapshot]
    );
  }
  await pool.query(
    `INSERT INTO production_model_routing_versions (routing_version_id,profile,scope_type,project_id,benchmark_run_id,dataset_version,decision_source,owner_decision,active,activated_at,provenance) VALUES ('${ROUTING_VERSION}','BALANCED','PROJECT','${PROJECT}','e2e-bench-leg-1','v1','BENCHMARK_EVIDENCE','APPROVED',TRUE,'2026-09-25T00:00:00.000Z','{}')`
  );
  await pool.query(
    `INSERT INTO production_model_routing_entries (routing_version_id,role,primary_model_id,price_snapshot_ids,evidence) VALUES ('${ROUTING_VERSION}','research','${LUNA}','{"${LUNA}":"${PRICE_LUNA}"}','{}')`
  );
  await pool.query(
    `INSERT INTO production_model_routing_entries (routing_version_id,role,primary_model_id,price_snapshot_ids,evidence) VALUES ('${ROUTING_VERSION}','research-synthesis','${NEMO}','{"${NEMO}":"${PRICE_NEMO}"}','{}')`
  );
  await pool.query(
    `UPDATE production_phase_call_budgets SET limit_count=$1, reserved_count=0, consumed_count=0, max_retries=0, active=TRUE, updated_at=$2 WHERE project_id='${PROJECT}' AND phase='PRE_MEDIA_PHASE' AND call_kind='research'`,
    [researchLimit, now]
  );
  await pool.query(
    `UPDATE production_phase_call_budgets SET limit_count=$1, reserved_count=0, consumed_count=0, max_retries=0, active=TRUE, updated_at=$2 WHERE project_id='${PROJECT}' AND phase='PRE_MEDIA_PHASE' AND call_kind='text_agent'`,
    [textLimit, now]
  );
}

async function seedScenario(pool, persistence, queue, suffix, options = {}) {
  const workflowId = `wf-e2e-leg-${suffix}`;
  const correlationId = `corr-e2e-leg-${suffix}`;
  const contentId = `content-e2e-leg-${suffix}`;
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
    ...(options.researchIntelligenceVersion ? { researchIntelligenceVersion: options.researchIntelligenceVersion } : {}),
  };
  await queue.submit({
    submissionKey: `e2e-leg-${suffix}`,
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
          research: { provider: "openrouter", model: LUNA },
          "*": { provider: "openrouter", model: LUNA },
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
    model: LUNA,
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

function makeBoundary(persistence, pool, searchResults = FACTUAL_RESULTS) {
  const realBoundary = buildProviderBoundary({ persistence, pool });
  const registry = createCapabilityRegistry({
    capabilities: [{ capabilityId: WEB_SEARCH_CAPABILITY_ID, description: "Governed web search", inputSchema: { type: "object" }, outputSchema: { type: "object" } }],
    grants: [{ agentId: "research", capabilityIds: [WEB_SEARCH_CAPABILITY_ID] }],
  });
  const searchExecutor = new WebSearchCapabilityExecutor(
    { search: async () => ({ providerId: "e2e-factual-fixture", results: searchResults }) },
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

async function dispatchRecovery(pool, persistence, { suffix, workflowId, researchStep, orchestratorStep, bounded }) {
  const dispatcher = new PostgresRecoveryDispatcher(pool, persistence);
  const input = {
    authorizationKey: `e2e-leg-${suffix}-v1`,
    workflowId,
    recoveryOfExecutionId: `exec-rec-${suffix}`,
    originalExecutionId: `exec-orig-${suffix}`,
    recoveryReason: `E2E_LEG_${suffix}`,
    recoveryAuthorization: "OWNER_APPROVED",
    targetStepId: researchStep.id,
    preserveCompletedStepIds: [orchestratorStep.id],
    requiredArtifactsByStep: { [orchestratorStep.id]: { artifactKind: "execution_plan" } },
    ...(bounded ? { stopAfterStepId: researchStep.id } : {}),
  };
  const first = await dispatcher.dispatch(input);
  assert.equal(first.created, true);
  return first;
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

function mockFetch(transports, handler) {
  const originalFetch = global.fetch;
  const originalKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "e2e-fixture-key";
  global.fetch = async (url, options) => {
    const target = String(url);
    if (target.includes("openrouter")) {
      if (target.includes("auth/key")) return new Response(JSON.stringify({ data: { label: "e2e" } }), { status: 200 });
      return handler(transports, JSON.parse(options.body));
    }
    throw new Error(`REAL_EGRESS_BLOCKED:${target.slice(0, 80)}`);
  };
  return () => {
    global.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = originalKey;
  };
}

const researchFailed = (records) => records.find((record) => record.agentId === "research" && record.status === "failed" && !String(record.executionId ?? "").startsWith("exec-"));

async function lifecycleEventsFor(pool, workflowId) {
  const rows = (await pool.query("SELECT execution_id,state,metadata FROM execution_lifecycle_events WHERE workflow_id=$1 ORDER BY event_id", [workflowId])).rows;
  return rows.map((row) => ({ executionId: row.execution_id, state: row.state, metadata: typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata }));
}

test("CASE 4: valid Nemo synthesis is CONSUMED with exact Nemo accounting via canonical lifecycle", async () => {
  const dbName = "amf_e2e_leg_case4_nemo_consumed";
  const { admin, pool } = await createScratchDb(dbName);
  const transports = [];
  let restoreFetch = () => {};
  try {
    await seedInfra(pool, 1, 2);
    const persistence = new PostgresPersistence(pool);
    const queue = new PostgresQueue(pool);
    const { workflowId, researchStep, orchestratorStep } = await seedScenario(pool, persistence, queue, "case4");
    await dispatchRecovery(pool, persistence, { suffix: "case4", workflowId, researchStep, orchestratorStep, bounded: true });
    restoreFetch = mockFetch(transports, (log, submitted) => {
      const body = JSON.stringify(submitted);
      const isSynthesis = body.includes("Post-retrieval synthesis");
      log.push({ model: submitted.model, synthesis: isSynthesis });
      if (isSynthesis) {
        assert.equal(submitted.model, NEMO, "synthesis leg must use the Nemo leg route, never Luna");
        return sse(NEMO, synthesisGrounded(researchStep.id), SYNTHESIS_COST);
      }
      assert.equal(submitted.model, LUNA);
      return sse(LUNA, synthesisPlan(researchStep.id), PLAN_COST);
    });
    const runtime = await createProductionWorker({ pool, providerBoundary: makeBoundary(persistence, pool), orphanStaleMs: 2_000_000_000 });
    assert.equal(await runtime.worker.runOnce(), true);
    await waitForSubmission(queue, workflowId, "bounded_stop");

    assert.equal(transports.filter((entry) => !entry.synthesis).length, 1);
    assert.equal(transports.filter((entry) => entry.synthesis).length, 1);
    assert.ok(transports.every((entry) => (entry.synthesis ? entry.model === NEMO : entry.model === LUNA)));

    const reservations = (await pool.query("SELECT reservation_id,role,call_kind,status,exact_model_id,routing_version_id,price_snapshot_id,idempotency_key,calculable_cost_usd FROM production_call_reservations WHERE workflow_id=$1 ORDER BY reserved_at", [workflowId])).rows;
    const researchReservations = reservations.filter((row) => row.role === "research");
    assert.equal(researchReservations.length, 3);
    assert.ok(researchReservations.every((row) => row.status === "CONSUMED"), "no double-reserve, no release on the submitted path");
    const planRes = researchReservations.find((row) => row.call_kind === "text_agent" && !row.idempotency_key.endsWith(":synthesis"));
    const synthRes = researchReservations.find((row) => row.call_kind === "text_agent" && row.idempotency_key.endsWith(":synthesis"));
    assert.ok(planRes && synthRes);
    strictEqual(planRes.exact_model_id, LUNA);
    strictEqual(synthRes.exact_model_id, NEMO, "FINAL_SYNTHESIS reservation carries the Nemo snapshot, never Luna");
    strictEqual(synthRes.routing_version_id, ROUTING_VERSION);
    strictEqual(synthRes.price_snapshot_id, PRICE_NEMO);
    assert.equal(Number(synthRes.calculable_cost_usd), SYNTHESIS_COST);

    const events = await lifecycleEventsFor(pool, workflowId);
    const synthesisIntents = events.filter((event) => event.state === "PROVIDER_SUBMISSION_INTENT" && event.metadata.callLeg === "FINAL_SYNTHESIS");
    assert.equal(synthesisIntents.length, 1, "exactly one governed lifecycle for the single synthesis transport (no double count)");
    strictEqual(synthesisIntents[0].metadata.reservationId, synthRes.reservation_id);
    strictEqual(synthesisIntents[0].metadata.callLeg, "FINAL_SYNTHESIS");
    // Leg model identity lives on the synthesis reservation row (exact Nemo
    // snapshot above) and on the leg transport events below; the shared
    // step-level INTENT row keeps the step model by design (one execution
    // row per step, legs distinguished by callLeg + reservationId).
    const synthesisFetches = events.filter((event) => event.state === "FETCH_INVOCATION_STARTED" && event.metadata.reservationId === synthRes.reservation_id);
    assert.equal(synthesisFetches.length, 1);
    strictEqual(synthesisFetches[0].metadata.model, NEMO);
    const synthesisResponses = events.filter((event) => event.state === "PROVIDER_RESPONSE_RECEIVED" && event.metadata.reservationId === synthRes.reservation_id);
    assert.equal(synthesisResponses.length, 1);
    strictEqual(synthesisResponses[0].metadata.actualModel, NEMO);
    const directionIntents = events.filter((event) => event.state === "PROVIDER_SUBMISSION_INTENT" && event.metadata.callLeg === "DIRECTION");
    assert.equal(directionIntents.length, 1);
    strictEqual(directionIntents[0].metadata.reservationId, planRes.reservation_id);

    const report = (await persistence.listArtifacts(workflowId)).find((artifact) => artifact.kind === "research_report" && artifact.status === "completed");
    assert.ok(report);
    assert.equal(report.payload.evidenceQuality.ceoEligible, true);
  } finally {
    restoreFetch();
    await dropScratchDb(admin, pool, dbName);
  }
}, { timeout: 300000, concurrency: false });

test("CANARY-09 MIRROR: retrieval success plus insufficient Nemo synthesis stays blocked with durable diagnostics (submitted, never RELEASED)", async () => {
  const dbName = "amf_e2e_leg_mirror_blocked";
  const { admin, pool } = await createScratchDb(dbName);
  const transports = [];
  let restoreFetch = () => {};
  try {
    await seedInfra(pool, 4, 2);
    const persistence = new PostgresPersistence(pool);
    const queue = new PostgresQueue(pool);
    const { workflowId, researchStep, orchestratorStep } = await seedScenario(pool, persistence, queue, "mirror", { researchIntelligenceVersion: "V2" });
    await dispatchRecovery(pool, persistence, { suffix: "mirror", workflowId, researchStep, orchestratorStep, bounded: false });
    restoreFetch = mockFetch(transports, (log, submitted) => {
      const body = JSON.stringify(submitted);
      if (body.includes("Research Direction")) {
        log.push({ model: submitted.model, leg: "DIRECTION" });
        assert.equal(submitted.model, LUNA);
        return sse(LUNA, v2Mission(researchStep.id), PLAN_COST);
      }
      log.push({ model: submitted.model, leg: "FINAL_SYNTHESIS" });
      assert.equal(submitted.model, NEMO, "synthesis leg must use Nemo even on the blocked path");
      assert.ok(submitted.max_tokens >= 8192, "synthesis output floor preserved");
      strictEqual(submitted.response_format.type, "json_schema");
      strictEqual(submitted.response_format.json_schema.strict, false);
      return sse(NEMO, v2Insufficient(researchStep.id), SYNTHESIS_COST);
    });
    const runtime = await createProductionWorker({ pool, providerBoundary: makeBoundary(persistence, pool), orphanStaleMs: 2_000_000_000 });
    assert.equal(await runtime.worker.runOnce(), true);
    await waitForSubmission(queue, workflowId, "failed");

    assert.ok(transports.some((entry) => entry.leg === "DIRECTION" && entry.model === LUNA));
    assert.ok(transports.some((entry) => entry.leg === "FINAL_SYNTHESIS" && entry.model === NEMO));

    const jobs = (await pool.query("SELECT status,error FROM workflow_jobs WHERE workflow_id=$1 ORDER BY created_at", [workflowId])).rows;
    assert.ok(jobs.some((job) => job.status === "failed"), "recovery job records the failed terminal state");

    const reservations = (await pool.query("SELECT call_kind,status,exact_model_id,idempotency_key FROM production_call_reservations WHERE workflow_id=$1 AND role='research' ORDER BY reserved_at", [workflowId])).rows;
    const synthRes = reservations.find((row) => row.call_kind === "text_agent" && row.idempotency_key.endsWith(":synthesis"));
    assert.ok(synthRes);
    strictEqual(synthRes.status, "FAILED_AFTER_SUBMISSION", "submitted Nemo synthesis must never reconcile as RELEASED");
    strictEqual(synthRes.exact_model_id, NEMO);

    const failed = researchFailed(await persistence.listExecutionProvenance(workflowId));
    assert.ok(failed);
    assert.ok(String(failed.configuration?.failureMessage ?? "").includes("AGENT_OUTPUT_BLOCKED:research"), "failed provenance preserves the blocked verdict");
    const blocked = failed.configuration?.providerFailure?.researchBlocked;
    assert.ok(blocked, "blocked Research must retain bounded evidence-gate diagnostics");
    strictEqual(blocked.ceoEligible, false);
    strictEqual(blocked.synthesisEligibility, "SUBMITTED");
    strictEqual(blocked.synthesisSubmitted, true);
    assert.ok(Array.isArray(blocked.failedGatePaths) && blocked.failedGatePaths.length > 0);
    assert.ok(blocked.retrievalCount > 0);
    const serializedFailure = JSON.stringify(failed.configuration.providerFailure);
    strictEqual(serializedFailure.includes("Smithsonian survey"), false, "no raw evidence text in durable diagnostics");
    strictEqual(serializedFailure.includes("si.edu/spotlight"), false, "no source URLs in durable diagnostics");

    const events = await lifecycleEventsFor(pool, workflowId);
    const terminal = events.filter((event) => event.state === "FAILED").at(-1);
    assert.ok(terminal);
    assert.ok(terminal.metadata.researchBlocked, "FAILED lifecycle event carries the bounded block diagnostics");
    strictEqual(terminal.metadata.researchBlocked.ceoEligible, false);

    const artifacts = await persistence.listArtifacts(workflowId);
    assert.equal(artifacts.filter((artifact) => artifact.kind === "research_report" && artifact.status === "completed").length, 0, "blocked remains blocked: no completed report");
    assert.equal(artifacts.filter((artifact) => artifact.producerAgent === "ceo").length, 0, "no downstream fabrication past the gate");
    const ceoReservations = (await pool.query("SELECT * FROM production_call_reservations WHERE workflow_id=$1 AND role='ceo'", [workflowId])).rows;
    assert.equal(ceoReservations.length, 0);
  } finally {
    restoreFetch();
    await dropScratchDb(admin, pool, dbName);
  }
}, { timeout: 300000, concurrency: false });

test("CASE 1: pre-submission direction failure releases synthesis with zero Nemo transport", async () => {
  const dbName = "amf_e2e_leg_case1_presubmission";
  const { admin, pool } = await createScratchDb(dbName);
  const transports = [];
  let restoreFetch = () => {};
  try {
    await seedInfra(pool, 4, 2);
    const persistence = new PostgresPersistence(pool);
    const queue = new PostgresQueue(pool);
    const { workflowId, researchStep, orchestratorStep } = await seedScenario(pool, persistence, queue, "case1", { researchIntelligenceVersion: "V2" });
    await dispatchRecovery(pool, persistence, { suffix: "case1", workflowId, researchStep, orchestratorStep, bounded: false });
    restoreFetch = mockFetch(transports, (log, submitted) => {
      log.push({ model: submitted.model });
      return sse(LUNA, "{not-json", PLAN_COST);
    });
    const runtime = await createProductionWorker({ pool, providerBoundary: makeBoundary(persistence, pool), orphanStaleMs: 2_000_000_000 });
    assert.equal(await runtime.worker.runOnce(), true);
    await waitForSubmission(queue, workflowId, "failed");

    assert.ok(transports.length > 0, "direction attempted");
    assert.ok(transports.every((entry) => entry.model !== NEMO), "zero Nemo transport before submission");

    const reservations = (await pool.query("SELECT call_kind,status,exact_model_id,idempotency_key FROM production_call_reservations WHERE workflow_id=$1 AND role='research' ORDER BY reserved_at", [workflowId])).rows;
    const synthRes = reservations.find((row) => row.call_kind === "text_agent" && row.idempotency_key.endsWith(":synthesis"));
    assert.ok(synthRes);
    strictEqual(synthRes.status, "RELEASED_BEFORE_SUBMISSION", "unsubmitted synthesis releases, never consumes");
    strictEqual(synthRes.exact_model_id, NEMO, "leg identity retained even when released");

    const events = await lifecycleEventsFor(pool, workflowId);
    const synthLinked = events.filter((event) => typeof synthRes.idempotency_key === "string" && event.metadata?.idempotencyKey === synthRes.idempotency_key);
    assert.equal(synthLinked.length, 0, "no lifecycle evidence may be inferred for an unsubmitted leg");
  } finally {
    restoreFetch();
    await dropScratchDb(admin, pool, dbName);
  }
}, { timeout: 300000, concurrency: false });

test("CASE 2: Nemo transport failure after fetch start stays submitted (never RELEASED)", async () => {
  const dbName = "amf_e2e_leg_case2_transport_fail";
  const { admin, pool } = await createScratchDb(dbName);
  const transports = [];
  let restoreFetch = () => {};
  try {
    await seedInfra(pool, 4, 2);
    const persistence = new PostgresPersistence(pool);
    const queue = new PostgresQueue(pool);
    const { workflowId, researchStep, orchestratorStep } = await seedScenario(pool, persistence, queue, "case2", { researchIntelligenceVersion: "V2" });
    await dispatchRecovery(pool, persistence, { suffix: "case2", workflowId, researchStep, orchestratorStep, bounded: false });
    restoreFetch = mockFetch(transports, (log, submitted) => {
      const body = JSON.stringify(submitted);
      if (body.includes("Research Direction")) {
        log.push({ model: submitted.model, leg: "DIRECTION" });
        return sse(LUNA, v2Mission(researchStep.id), PLAN_COST);
      }
      log.push({ model: submitted.model, leg: "FINAL_SYNTHESIS" });
      assert.equal(submitted.model, NEMO);
      return new Response("upstream failure", { status: 500 });
    });
    const runtime = await createProductionWorker({ pool, providerBoundary: makeBoundary(persistence, pool), orphanStaleMs: 2_000_000_000 });
    assert.equal(await runtime.worker.runOnce(), true);
    await waitForSubmission(queue, workflowId, "failed");

    assert.ok(transports.some((entry) => entry.leg === "FINAL_SYNTHESIS" && entry.model === NEMO));
    const reservations = (await pool.query("SELECT call_kind,status,exact_model_id,idempotency_key,reservation_id FROM production_call_reservations WHERE workflow_id=$1 AND role='research' ORDER BY reserved_at", [workflowId])).rows;
    const synthRes = reservations.find((row) => row.call_kind === "text_agent" && row.idempotency_key.endsWith(":synthesis"));
    assert.ok(synthRes);
    strictEqual(synthRes.status, "FAILED_AFTER_SUBMISSION", "transport started => submitted failure, never a release");
    const events = await lifecycleEventsFor(pool, workflowId);
    const synthEvents = events.filter((event) => event.metadata?.reservationId === synthRes.reservation_id);
    assert.ok(synthEvents.some((event) => event.state === "FETCH_INVOCATION_STARTED"), "fetch-start evidence proves submission");
    const headers = synthEvents.filter((event) => event.state === "HTTP_RESPONSE_HEADERS_RECEIVED");
    assert.equal(headers.length, 1, "provider headers evidence is durable even on transport failure");
    strictEqual(headers[0].metadata.httpStatus, 500);
    const failed = researchFailed(await persistence.listExecutionProvenance(workflowId));
    assert.ok(failed);
    // Pre-existing canonical mapping for non-2xx transport errors (out of
    // scope for this task): the submitted state, not the label, is the
    // lifecycle guarantee under test.
    strictEqual(failed.errorClassification, "LOCAL_EXECUTION_FAILED");
    assert.match(String(failed.configuration?.failureMessage ?? ""), /500/);
  } finally {
    restoreFetch();
    await dropScratchDb(admin, pool, dbName);
  }
}, { timeout: 300000, concurrency: false });

test("CASE 3: Nemo response rejected by the structural validator stays FAILED_AFTER_SUBMISSION with classification", async () => {
  const dbName = "amf_e2e_leg_case3_validation_fail";
  const { admin, pool } = await createScratchDb(dbName);
  const transports = [];
  let restoreFetch = () => {};
  try {
    await seedInfra(pool, 4, 2);
    const persistence = new PostgresPersistence(pool);
    const queue = new PostgresQueue(pool);
    const { workflowId, researchStep, orchestratorStep } = await seedScenario(pool, persistence, queue, "case3", { researchIntelligenceVersion: "V2" });
    await dispatchRecovery(pool, persistence, { suffix: "case3", workflowId, researchStep, orchestratorStep, bounded: false });
    restoreFetch = mockFetch(transports, (log, submitted) => {
      const body = JSON.stringify(submitted);
      if (body.includes("Research Direction")) {
        log.push({ model: submitted.model, leg: "DIRECTION" });
        return sse(LUNA, v2Mission(researchStep.id), PLAN_COST);
      }
      log.push({ model: submitted.model, leg: "FINAL_SYNTHESIS" });
      return sse(NEMO, { taskId: `research-${researchStep.id}`, stage: researchStep.id }, SYNTHESIS_COST);
    });
    const runtime = await createProductionWorker({ pool, providerBoundary: makeBoundary(persistence, pool), orphanStaleMs: 2_000_000_000 });
    assert.equal(await runtime.worker.runOnce(), true);
    await waitForSubmission(queue, workflowId, "failed");

    const reservations = (await pool.query("SELECT call_kind,status,exact_model_id,idempotency_key FROM production_call_reservations WHERE workflow_id=$1 AND role='research' ORDER BY reserved_at", [workflowId])).rows;
    const synthRes = reservations.find((row) => row.call_kind === "text_agent" && row.idempotency_key.endsWith(":synthesis"));
    assert.ok(synthRes);
    strictEqual(synthRes.status, "FAILED_AFTER_SUBMISSION", "validated-against provider output is a submitted failure");
    strictEqual(synthRes.exact_model_id, NEMO);
    const failed = researchFailed(await persistence.listExecutionProvenance(workflowId));
    assert.ok(failed);
    strictEqual(failed.errorClassification, "STRUCTURAL_VALIDATION_FAILED");
    const events = await lifecycleEventsFor(pool, workflowId);
    const terminal = events.filter((event) => event.state === "FAILED").at(-1);
    assert.ok(terminal);
    strictEqual(terminal.metadata.validationKind, "STRUCTURAL");
  } finally {
    restoreFetch();
    await dropScratchDb(admin, pool, dbName);
  }
}, { timeout: 300000, concurrency: false });

test("CASE 7: blocked Research diagnostics survive a synthesis budget reconciliation reporter failure", async () => {
  const dbName = "amf_e2e_leg_case7_reconcile_reporter";
  const { admin, pool } = await createScratchDb(dbName);
  const transports = [];
  const originalReconcile = ProductionCallBudgetStore.prototype.reconcile;
  let restoreFetch = () => {};
  try {
    await seedInfra(pool, 4, 2);
    const persistence = new PostgresPersistence(pool);
    const queue = new PostgresQueue(pool);
    const { workflowId, researchStep, orchestratorStep } = await seedScenario(pool, persistence, queue, "case7", { researchIntelligenceVersion: "V2" });
    await dispatchRecovery(pool, persistence, { suffix: "case7", workflowId, researchStep, orchestratorStep, bounded: false });
    restoreFetch = mockFetch(transports, (log, submitted) => {
      const body = JSON.stringify(submitted);
      if (body.includes("Research Direction")) {
        log.push({ model: submitted.model, leg: "DIRECTION" });
        return sse(LUNA, v2Mission(researchStep.id), PLAN_COST);
      }
      log.push({ model: submitted.model, leg: "FINAL_SYNTHESIS" });
      return sse(NEMO, v2Insufficient(researchStep.id), SYNTHESIS_COST);
    });
    ProductionCallBudgetStore.prototype.reconcile = async function (input) {
      const row = (await pool.query("SELECT idempotency_key FROM production_call_reservations WHERE reservation_id=$1", [input.reservationId])).rows[0];
      if (String(row?.idempotency_key ?? "").endsWith(":synthesis")) throw new Error("FIXTURE_SYNTHESIS_RECONCILIATION_REPORTER_FAILED");
      return originalReconcile.call(this, input);
    };

    const runtime = await createProductionWorker({ pool, providerBoundary: makeBoundary(persistence, pool), orphanStaleMs: 2_000_000_000 });
    assert.equal(await runtime.worker.runOnce(), true);
    await waitForSubmission(queue, workflowId, "failed");

    const current = (await persistence.listExecutionProvenance(workflowId))
      .filter((record) => record.agentId === "research" && !String(record.executionId ?? "").startsWith("exec-"))
      .at(-1);
    assert.ok(current, "current Research attempt remains durable");
    assert.equal(current.status, "failed", "reporter failure must not suppress the terminal Research failure record");
    assert.equal(current.configuration?.providerFailure?.researchBlocked?.ceoEligible, false);
    assert.ok(current.configuration?.providerFailure?.researchBlocked?.failedGatePaths?.length > 0);
    assert.match(String(current.configuration?.budgetReconciliationFailure ?? ""), /FIXTURE_SYNTHESIS_RECONCILIATION_REPORTER_FAILED/);
  } finally {
    ProductionCallBudgetStore.prototype.reconcile = originalReconcile;
    restoreFetch();
    await dropScratchDb(admin, pool, dbName);
  }
}, { timeout: 300000, concurrency: false });

test("CASE 10: exact duplicate Direction plus Final Synthesis recovery creates no duplicate effect", async () => {
  const dbName = "amf_e2e_leg_case10_exact_duplicate";
  const { admin, pool } = await createScratchDb(dbName);
  const transports = [];
  const reconcileCounts = new Map();
  const originalReconcile = ProductionCallBudgetStore.prototype.reconcile;
  let restoreFetch = () => {};
  try {
    await seedInfra(pool, 1, 2);
    const persistence = new PostgresPersistence(pool);
    const queue = new PostgresQueue(pool);
    const { workflowId, researchStep, orchestratorStep } = await seedScenario(pool, persistence, queue, "case10");
    const firstDispatch = await dispatchRecovery(pool, persistence, { suffix: "case10", workflowId, researchStep, orchestratorStep, bounded: true });

    ProductionCallBudgetStore.prototype.reconcile = async function (input) {
      const row = (await pool.query("SELECT idempotency_key FROM production_call_reservations WHERE reservation_id=$1", [input.reservationId])).rows[0];
      const identity = String(row?.idempotency_key ?? input.reservationId);
      reconcileCounts.set(identity, (reconcileCounts.get(identity) ?? 0) + 1);
      return originalReconcile.call(this, input);
    };
    restoreFetch = mockFetch(transports, (log, submitted) => {
      const body = JSON.stringify(submitted);
      const synthesis = body.includes("Post-retrieval synthesis");
      log.push({ model: submitted.model, synthesis });
      return synthesis
        ? sse(NEMO, synthesisGrounded(researchStep.id), SYNTHESIS_COST)
        : sse(LUNA, synthesisPlan(researchStep.id), PLAN_COST);
    });

    const runtime = await createProductionWorker({ pool, providerBoundary: makeBoundary(persistence, pool), orphanStaleMs: 2_000_000_000 });
    assert.equal(await runtime.worker.runOnce(), true);
    await waitForSubmission(queue, workflowId, "bounded_stop");

    const beforeReservations = (await pool.query(
      "SELECT reservation_id,idempotency_key,call_kind,status,calculable_cost_usd,reconciled_at FROM production_call_reservations WHERE workflow_id=$1 AND role='research' ORDER BY reserved_at",
      [workflowId],
    )).rows;
    const direction = beforeReservations.find((row) => row.call_kind === "text_agent" && !row.idempotency_key.endsWith(":synthesis"));
    const synthesis = beforeReservations.find((row) => row.call_kind === "text_agent" && row.idempotency_key.endsWith(":synthesis"));
    assert.ok(direction && synthesis);
    assert.equal(transports.filter((entry) => !entry.synthesis).length, 1);
    assert.equal(transports.filter((entry) => entry.synthesis).length, 1);
    assert.equal(reconcileCounts.get(direction.idempotency_key), 1);
    assert.equal(reconcileCounts.get(synthesis.idempotency_key), 1);
    const beforeArtifacts = (await persistence.listArtifacts(workflowId)).filter((artifact) => artifact.kind === "research_report");
    assert.equal(beforeArtifacts.length, 1);
    const beforeBudget = (await pool.query(
      "SELECT call_kind,reserved_count,consumed_count FROM production_phase_call_budgets WHERE project_id=$1 AND phase='PRE_MEDIA_PHASE' AND call_kind=ANY($2::text[]) ORDER BY call_kind",
      [PROJECT, ["research", "text_agent"]],
    )).rows;

    const duplicateDispatch = await new PostgresRecoveryDispatcher(pool, persistence).dispatch({
      authorizationKey: "e2e-leg-case10-v1",
      workflowId,
      recoveryOfExecutionId: "exec-rec-case10",
      originalExecutionId: "exec-orig-case10",
      recoveryReason: "E2E_LEG_case10",
      recoveryAuthorization: "OWNER_APPROVED",
      targetStepId: researchStep.id,
      preserveCompletedStepIds: [orchestratorStep.id],
      requiredArtifactsByStep: { [orchestratorStep.id]: { artifactKind: "execution_plan" } },
      stopAfterStepId: researchStep.id,
    });
    assert.equal(duplicateDispatch.created, false);
    assert.equal(duplicateDispatch.recoveryExecutionId, firstDispatch.recoveryExecutionId);
    assert.equal(duplicateDispatch.jobId, firstDispatch.jobId);
    assert.equal(await runtime.worker.runOnce(), false, "exact duplicate dispatch creates no second queue execution");

    const afterReservations = (await pool.query(
      "SELECT reservation_id,idempotency_key,call_kind,status,calculable_cost_usd,reconciled_at FROM production_call_reservations WHERE workflow_id=$1 AND role='research' ORDER BY reserved_at",
      [workflowId],
    )).rows;
    assert.deepEqual(afterReservations, beforeReservations, "duplicate creates no effective reservation or accounting mutation");
    assert.equal(transports.filter((entry) => !entry.synthesis).length, 1, "no duplicate Direction submission");
    assert.equal(transports.filter((entry) => entry.synthesis).length, 1, "no duplicate Final Synthesis submission");
    assert.equal(reconcileCounts.get(direction.idempotency_key), 1, "Direction reconciles exactly once");
    assert.equal(reconcileCounts.get(synthesis.idempotency_key), 1, "Final Synthesis reconciles exactly once");
    assert.deepEqual((await pool.query(
      "SELECT call_kind,reserved_count,consumed_count FROM production_phase_call_budgets WHERE project_id=$1 AND phase='PRE_MEDIA_PHASE' AND call_kind=ANY($2::text[]) ORDER BY call_kind",
      [PROJECT, ["research", "text_agent"]],
    )).rows, beforeBudget, "duplicate adds no provider cost or budget consumption");
    const afterArtifacts = (await persistence.listArtifacts(workflowId)).filter((artifact) => artifact.kind === "research_report");
    assert.equal(afterArtifacts.length, 1);
    assert.equal(afterArtifacts[0].artifactId, beforeArtifacts[0].artifactId);
  } finally {
    ProductionCallBudgetStore.prototype.reconcile = originalReconcile;
    restoreFetch();
    await dropScratchDb(admin, pool, dbName);
  }
}, { timeout: 300000, concurrency: false });
