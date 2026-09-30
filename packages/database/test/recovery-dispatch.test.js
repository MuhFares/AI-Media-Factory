import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ControlPlaneStore, createPool, migrate, PostgresPersistence, PostgresQueue, PostgresRecoveryDispatcher } from "../dist/index.js";
import { workflow } from "@ai-media-factory/workflow-engine";
import { createProductionAgentExecutor, WorkflowWorker } from "@ai-media-factory/worker";
import { TEST_DATABASE_URL, assertTestDatabaseIsolation } from "./helpers.js";

const definition = workflow().id("recovery-v2-review").version(1).trigger("manual", "test").entryStep("writer")
  .addAgentStep({ id: "writer", agent: "writer", emits: "writer_report", next: "seo" })
  .addAgentStep({ id: "seo", agent: "seo", emits: "seo_report", next: "brand" })
  .addAgentStep({ id: "brand", agent: "brand", emits: "brand_report", next: "review" })
  .addAgentStep({ id: "review", agent: "review", emits: "review_report", next: "visual-human-gate" })
  .addGateStep({ id: "visual-human-gate", approver: "human_operator", reason: "test visual approval", next: undefined }).build();
const originalFetch = global.fetch, originalProvider = process.env.TEXT_AGENT_PROVIDER, originalKey = process.env.OPENROUTER_API_KEY, originalBase = process.env.OPENROUTER_BASE_URL;
let pool, persistence, queue, control;
const now = () => new Date().toISOString();
async function eventually(check, timeoutMs = 5000) { const deadline = Date.now() + timeoutMs; while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error("timed out waiting for durable recovery state"); }
const sse = (content, requestId) => `data: ${JSON.stringify({ id: requestId, choices: [{ delta: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 7, completion_tokens: 11 } })}\n\ndata: [DONE]\n\n`;

async function seedRecovery(name) {
  const workflowId = randomUUID(), correlationId = randomUUID();
  const originalExecutionId = `original-review-${name}-${randomUUID()}`, ambiguousExecutionId = `ambiguous-review-${name}-${randomUUID()}`;
  await control.saveCommand({ commandId: `command-${workflowId}`, projectId: `recovery-project-${name}`, mode: "START_GOVERNED_TASK", ownerMessage: "provider-free Review fixture", selectedAgents: ["review"], context: {}, taskClassification: "TEST", workflowId, status: "WORKING", artifactRefs: [], createdAt: now() });
  const artifact = (artifactId, kind, producerAgent, payload, parentArtifact) => ({ artifactId, kind, producerAgent, workflowId, correlationId, status: "completed", payload, contentType: "application/json", schemaVersion: "1.0.0", createdAt: now(), ...(parentArtifact ? { parentArtifact } : {}) });
  await queue.submit({ submissionKey: `recovery-source-${name}-${workflowId}`, workflowId, directive: "recovery-v2-test", correlationId, brandId: `recovery-project-${name}`, definition });
  await persistence.saveWorkflow({ workflowId, definitionId: definition.id, definitionVersion: definition.version, state: "FAILED", context: { workflowId, correlationId, brandId: `recovery-project-${name}`, data: { directive: "recovery-v2-test", commandId: `command-${workflowId}`, previousArtifact: { artifactId: `canonical-brand-${name}`, kind: "brand_report" } }, outputs: {} }, ready: [], lastCheckpointRef: null, createdAt: now(), updatedAt: now(), steps: definition.steps.map((step) => ({ stepId: step.id, status: ["writer", "seo", "brand"].includes(step.id) ? "completed" : "pending", attempts: 1, startedAt: now(), finishedAt: now() })) });
  await persistence.saveArtifact(artifact(`canonical-writer-${name}`, "writer_report", "writer", { title: "Recovered title", content: "Recovered canonical content." }));
  await persistence.saveArtifact(artifact(`canonical-seo-${name}`, "seo_report", "seo", { optimizedTitle: "Recovered title", score: 90 }, { artifactId: `canonical-writer-${name}`, kind: "writer_report" }));
  await persistence.saveArtifact(artifact(`canonical-brand-${name}`, "brand_report", "brand", { status: "approved", summary: "Canonical brand approval." }, { artifactId: `canonical-seo-${name}`, kind: "seo_report" }));
  for (const executionId of [originalExecutionId, ambiguousExecutionId]) await persistence.saveExecutionProvenance({ executionId, workflowId, correlationId, agentId: "review", stage: "review", capability: "agent.execute", provider: "openrouter", model: "test", runtime: "test", promptVersion: null, configurationFingerprint: null, startedAt: now(), completedAt: now(), latencyMs: 0, status: "blocked", usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: [], parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: null, errorClassification: null, configuration: { lifecycleState: "PROVIDER_TRANSPORT_FAILED" } });
  return { workflowId, correlationId, originalExecutionId, ambiguousExecutionId };
}

async function dispatchAndRun(name, content, failureInjection = null) {
  const seeded = await seedRecovery(name); let fetchCalls = 0;
  global.fetch = async () => { fetchCalls += 1; return new Response(sse(content, `frozen-${name}`), { status: 200, headers: { "x-request-id": `frozen-${name}` } }); };
  const dispatcher = new PostgresRecoveryDispatcher(pool, persistence);
  const input = { authorizationKey: `owner-approved-${name}-${seeded.workflowId}`, workflowId: seeded.workflowId, recoveryOfExecutionId: seeded.ambiguousExecutionId, originalExecutionId: seeded.originalExecutionId, recoveryReason: "provider-free recovery proof", recoveryAuthorization: "OWNER_APPROVED", targetStepId: "review", preserveCompletedStepIds: ["writer", "seo", "brand"], requiredArtifactsByStep: { writer: { artifactKind: "writer_report" }, seo: { artifactKind: "seo_report" }, brand: { artifactKind: "brand_report" } }, commandId: `command-${seeded.workflowId}`, controlAgentOverrides: { review: { provider: "openrouter", model: "nex-agi/nex-n2.5-pro:free" } } };
  const first = await dispatcher.dispatch(input), duplicate = await dispatcher.dispatch(input);
  assert.equal(first.created, true); assert.equal(duplicate.created, false); assert.equal(duplicate.jobId, first.jobId);
  const originalAppend = persistence.appendExecutionLifecycleEvent;
  const originalFallback = persistence.appendExecutionFailureFallbackEvent;
  const originalProjection = persistence.saveExecutionProvenance;
  if (failureInjection) {
    persistence.appendExecutionLifecycleEvent = async function (event) {
      if (event.executionId === first.recoveryExecutionId && event.state === "FAILED" && failureInjection !== "projection" && failureInjection !== "runtime" && failureInjection !== "runtime-wrapped") throw new Error("injected terminal lifecycle insert failure");
      const persisted = await originalAppend.call(this, event);
      if (event.executionId === first.recoveryExecutionId && event.state === "VALIDATING" && failureInjection.startsWith("runtime")) {
        const inner = new Error("injected post-validation local runtime failure");
        throw failureInjection === "runtime-wrapped" ? new Error("runtime callback wrapper", { cause: inner }) : inner;
      }
      return persisted;
    };
    if (failureInjection === "both") persistence.appendExecutionFailureFallbackEvent = async () => { throw new Error("injected fallback write failure"); };
    if (["both", "projection"].includes(failureInjection)) persistence.saveExecutionProvenance = async function (record) {
      if (record.executionId === first.recoveryExecutionId && record.status === "failed") throw new Error("injected terminal projection write failure");
      return originalProjection.call(this, record);
    };
  }
  const worker = new WorkflowWorker({ queue, persistence, executor: createProductionAgentExecutor({ persistence, pool }), control, pollMs: 5 });
  const loop = worker.runLoop();
  return { ...seeded, recoveryExecutionId: first.recoveryExecutionId, jobId: first.jobId, fetchCalls: () => fetchCalls, stop: async () => { worker.stop(); await loop; persistence.appendExecutionLifecycleEvent = originalAppend; persistence.appendExecutionFailureFallbackEvent = originalFallback; persistence.saveExecutionProvenance = originalProjection; } };
}

async function assertNegativeCase(name, content, expected) {
  const run = await dispatchAndRun(name, content);
  try {
    assert.equal(await eventually(async () => (await persistence.loadWorkflow(run.workflowId))?.state === "FAILED"), true);
    assert.equal(run.fetchCalls(), 1, "one claimed recovery job may cross frozen fetch");
    const lifecycle = (await persistence.listExecutionProvenance(run.workflowId)).find((item) => item.executionId === run.recoveryExecutionId);
    assert.equal(lifecycle.status, "failed"); assert.equal(lifecycle.configuration.providerFailure.validationStage, expected.validationStage);
    for (const [key, value] of Object.entries(expected.diagnostics)) assert.deepEqual(lifecycle.configuration.providerFailure[key], value);
    const events = await persistence.listExecutionLifecycleEvents(run.recoveryExecutionId);
    const states = events.map((event) => event.state);
    assert.equal(states.at(-1), "FAILED"); assert.ok(states.includes("VALIDATING"));
    assert.equal(states.includes("ARTIFACT_PERSISTING"), false); assert.equal(states.includes("COMPLETED"), false);
    const failed = events.at(-1).metadata;
    assert.equal(failed.validationStage, expected.validationStage);
    for (const [key, value] of Object.entries(expected.diagnostics)) assert.deepEqual(failed[key], value);
    // Canonical provider-response evidence may retain the bounded visible JSON
    // and its parsed form, but never the raw SSE/provider envelope.
    const durableDiagnostics = JSON.stringify({ lifecycle, events });
    assert.equal(durableDiagnostics.includes('"choices"'), false);
    assert.equal(durableDiagnostics.includes("[DONE]"), false);
    assert.equal((await persistence.listArtifacts(run.workflowId)).filter((item) => item.kind === "review_report").length, 0);
    assert.equal(await control.getApproval(`approval-${run.workflowId}-visual-human-gate`), null);
    const workflowState = await persistence.loadWorkflow(run.workflowId);
    assert.equal(workflowState.steps.find((step) => step.stepId === "visual-human-gate").status, "pending");
    for (const id of ["writer", "seo", "brand"]) assert.equal(workflowState.steps.find((step) => step.stepId === id).attempts, 1, `${id} was not replayed`);
  } finally { await run.stop(); }
}

before(async () => {
  assertTestDatabaseIsolation(); pool = createPool({ connectionString: TEST_DATABASE_URL }); await migrate(pool);
  assert.equal((await pool.query("SELECT current_database() AS name")).rows[0].name, "ai_media_factory_test");
  await pool.query("TRUNCATE review_revision_tasks, control_commands, control_approvals, workflow_submissions, workflow_jobs, workflow_instances, workflow_steps, workflow_checkpoints, artifacts, capability_executions, execution_evidence, decisions, execution_provenance, workflow_recovery_dispatches, execution_failure_fallback_events RESTART IDENTITY CASCADE");
  persistence = new PostgresPersistence(pool); queue = new PostgresQueue(pool); control = new ControlPlaneStore(pool);
  process.env.TEXT_AGENT_PROVIDER = "openrouter"; process.env.OPENROUTER_API_KEY = "test-only-frozen"; process.env.OPENROUTER_BASE_URL = "https://frozen.invalid/api/v1";
});
after(async () => { global.fetch = originalFetch; process.env.TEXT_AGENT_PROVIDER = originalProvider; process.env.OPENROUTER_API_KEY = originalKey; process.env.OPENROUTER_BASE_URL = originalBase; if (persistence) await persistence.close(); });

test("Recovery V2 durably retains parse diagnostics without raw provider body", async () => {
  await assertNegativeCase("parse", "not-json", { validationStage: "parse", diagnostics: { validationCode: "REVIEW_PARSE_NON_JSON" } });
});

test("Recovery V2 durably retains structural diagnostics without raw provider body", async () => {
  await assertNegativeCase("structural", JSON.stringify({ reportId: "only-id" }), { validationStage: "structural", diagnostics: { validationCode: "REVIEW_STRUCTURAL_INVALID_REPORT", issueCount: 1, issuePaths: ["$"], issueCodes: ["INVALID_REPORT"] } });
});

test("Recovery V2 durably retains semantic diagnostics without raw provider body", async () => {
  const invalid = { reportId: randomUUID(), taskDescription: "wrong task", summary: "Approved.", status: "approved", findings: [], recommendations: [], metadata: { createdAt: "2026-09-13T00:00:00.000Z", agentVersion: "1.0.0" } };
  await assertNegativeCase("semantic", JSON.stringify(invalid), { validationStage: "semantic", diagnostics: { validationCode: "REVIEW_SEMANTIC_TASK_DESCRIPTION_MISMATCH", semanticRuleId: "REVIEW_SEMANTIC_TASK_DESCRIPTION_MATCH" } });
});

test("failed terminal insert leaves independent durable structural diagnostics and is duplicate-safe", async () => {
  const invalid = JSON.stringify({ reportId: "only-id" });
  const run = await dispatchAndRun("fallback-structural", invalid, "terminal");
  try {
    await eventually(async () => (await queue.listJobsByWorkflow(run.workflowId)).some((job) => job.jobId === run.jobId && job.status === "failed"));
    assert.equal(run.fetchCalls(), 1);
    const events = await persistence.listExecutionLifecycleEvents(run.recoveryExecutionId);
    assert.ok(events.some((event) => event.state === "VALIDATING"));
    assert.equal(events.some((event) => event.state === "FAILED"), false);
    const loaded = await new PostgresPersistence(pool).listExecutionFailureFallbackEvents(run.recoveryExecutionId);
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].metadata.eventCode, "TERMINAL_FAILURE_PERSISTENCE_FAILED");
    assert.equal(loaded[0].metadata.originalFailureClass, "STRUCTURAL_VALIDATION_FAILED");
    assert.equal(loaded[0].metadata.terminalPersistenceFailureClass, "Error");
    assert.equal(loaded[0].metadata.validationStage, "structural");
    assert.equal(loaded[0].metadata.originalFailureCode, "REVIEW_STRUCTURAL_INVALID_REPORT");
    assert.deepEqual(loaded[0].metadata.structuralIssuePaths, ["$"]);
    assert.deepEqual(loaded[0].metadata.structuralIssueCodes, ["INVALID_REPORT"]);
    assert.equal(JSON.stringify(loaded).includes(invalid), false);
    await persistence.appendExecutionFailureFallbackEvent(loaded[0]);
    assert.equal((await persistence.listExecutionFailureFallbackEvents(run.recoveryExecutionId)).length, 1);
    assert.equal((await persistence.listArtifacts(run.workflowId)).some((artifact) => artifact.kind === "review_report"), false);
  } finally { await run.stop(); }
});

test("double persistence failure reports unavailable durable evidence without provider replay", async () => {
  const run = await dispatchAndRun("fallback-outage", JSON.stringify({ reportId: "only-id" }), "both");
  try {
    const job = await eventually(async () => (await queue.listJobsByWorkflow(run.workflowId)).find((item) => item.jobId === run.jobId && item.status === "failed"));
    assert.equal(run.fetchCalls(), 1);
    assert.equal((await persistence.listExecutionFailureFallbackEvents(run.recoveryExecutionId)).length, 0);
    assert.equal((await persistence.listExecutionLifecycleEvents(run.recoveryExecutionId)).some((event) => event.state === "FAILED"), false);
    assert.match(job.error, /DURABLE_FAILURE_EVIDENCE_UNAVAILABLE/);
  } finally { await run.stop(); }
});

test("projection failure leaves the append-only FAILED event as forensic source", async () => {
  const run = await dispatchAndRun("projection-outage", JSON.stringify({ reportId: "only-id" }), "projection");
  try {
    await eventually(async () => (await queue.listJobsByWorkflow(run.workflowId)).some((item) => item.jobId === run.jobId && item.status === "failed"));
    assert.equal(run.fetchCalls(), 1);
    const events = await new PostgresPersistence(pool).listExecutionLifecycleEvents(run.recoveryExecutionId);
    assert.equal(events.at(-1).state, "FAILED");
    assert.equal(events.at(-1).metadata.validationStage, "structural");
    assert.equal((await persistence.listExecutionFailureFallbackEvents(run.recoveryExecutionId)).length, 0);
  } finally { await run.stop(); }
});

test("changes_requested Review completes, persists rationale, and creates one durable revision task", async () => {
  const report = { reportId: randomUUID(), taskDescription: "Review content for review", summary: "Changes required.", status: "changes_requested", findings: [{ id: "finding-1", severity: "high", category: "correctness", title: "Unsupported claim", description: "One claim needs evidence.", recommendation: "Revise the claim." }], recommendations: [{ priority: "high", description: "Revise the claim.", relatedFindingIds: ["finding-1"] }], metadata: { createdAt: "2026-09-13T00:00:00.000Z", agentVersion: "1.0.0" } };
  const run = await dispatchAndRun("business-revision", JSON.stringify(report));
  try {
    const job = await eventually(async () => (await queue.listJobsByWorkflow(run.workflowId)).find((item) => item.jobId === run.jobId && item.status === "succeeded"));
    assert.equal(job.attempts, 1);
    assert.equal(run.fetchCalls(), 1);
    const reader = new PostgresPersistence(pool);
    const events = await reader.listExecutionLifecycleEvents(run.recoveryExecutionId);
    assert.equal(events.at(-1).state, "COMPLETED");
    assert.ok(events.some((event) => event.state === "ARTIFACT_PERSISTING"));
    const reviews = (await reader.listArtifacts(run.workflowId)).filter((item) => item.kind === "review_report");
    assert.equal(reviews.length, 1); assert.deepEqual(reviews[0].payload, report);
    assert.equal(reviews[0].parentArtifact?.artifactId, "canonical-writer-business-revision");
    const workflowState = await reader.loadWorkflow(run.workflowId);
    assert.equal(workflowState.state, "REVISION_REQUIRED");
    assert.equal(workflowState.steps.find((step) => step.stepId === "review").status, "completed");
    assert.equal(workflowState.steps.find((step) => step.stepId === "visual-human-gate").status, "pending");
    const tasks = await control.listReviewRevisionTasks(`recovery-project-business-revision`);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].reviewArtifactId, reviews[0].artifactId);
    assert.equal(tasks[0].reviewExecutionId, run.recoveryExecutionId);
    assert.equal(tasks[0].commandId, `command-${run.workflowId}`);
    assert.equal(tasks[0].writerArtifactId, `canonical-writer-business-revision`);
    assert.equal(tasks[0].seoArtifactId, `canonical-seo-business-revision`);
    assert.equal(tasks[0].brandArtifactId, `canonical-brand-business-revision`);
    assert.deepEqual(tasks[0].findings, report.findings);
    assert.deepEqual(tasks[0].recommendations, report.recommendations);
    assert.equal(tasks[0].summary, report.summary);
    const command = (await control.listCommands(`recovery-project-business-revision`)).find((item) => item.command_id === `command-${run.workflowId}`);
    assert.equal(command.status, "REVISION_REQUIRED");
    assert.equal(command.visibleResult.reviewArtifactId, reviews[0].artifactId);
    assert.equal(await control.getApproval(`approval-${run.workflowId}-visual-human-gate`), null);
    const duplicateJobId = await queue.enqueue(run.workflowId, `recovery-source-business-revision-${run.workflowId}`);
    await eventually(async () => (await queue.listJobsByWorkflow(run.workflowId)).some((item) => item.jobId === duplicateJobId && item.status === "succeeded"));
    assert.equal(run.fetchCalls(), 1);
    assert.equal((await control.listReviewRevisionTasks(`recovery-project-business-revision`)).length, 1);
    assert.equal((await reader.listArtifacts(run.workflowId)).filter((item) => item.kind === "review_report").length, 1);
  } finally { await run.stop(); }
});

test("blocked Review completes with a durable business state and no revision or approval", async () => {
  const report = { reportId: randomUUID(), taskDescription: "Review content for review", summary: "Insufficient evidence.", status: "blocked", findings: [], recommendations: [{ priority: "high", description: "Supply evidence." }], metadata: { createdAt: "2026-09-13T00:00:00.000Z", agentVersion: "1.0.0" } };
  const run = await dispatchAndRun("business-blocked", JSON.stringify(report));
  try {
    await eventually(async () => (await queue.listJobsByWorkflow(run.workflowId)).some((item) => item.jobId === run.jobId && item.status === "succeeded"));
    assert.equal(run.fetchCalls(), 1);
    const reader = new PostgresPersistence(pool);
    const evidence = await reader.listExecutionLifecycleEvents(run.recoveryExecutionId);
    assert.equal(evidence.at(-1).state, "COMPLETED");
    const reviews = (await reader.listArtifacts(run.workflowId)).filter((item) => item.kind === "review_report");
    assert.equal(reviews.length, 1); assert.deepEqual(reviews[0].payload, report);
    assert.equal(reviews[0].parentArtifact?.artifactId, "canonical-writer-business-blocked");
    const workflowState = await reader.loadWorkflow(run.workflowId);
    assert.equal(workflowState.state, "BUSINESS_BLOCKED");
    assert.equal(workflowState.steps.find((step) => step.stepId === "visual-human-gate").status, "pending");
    assert.equal((await control.listReviewRevisionTasks(`recovery-project-business-blocked`)).length, 0);
    const command = (await control.listCommands(`recovery-project-business-blocked`)).find((item) => item.command_id === `command-${run.workflowId}`);
    assert.equal(command.status, "BUSINESS_BLOCKED");
    assert.equal(command.visibleResult.reviewArtifactId, reviews[0].artifactId);
    assert.equal(await control.getApproval(`approval-${run.workflowId}-visual-human-gate`), null);
  } finally { await run.stop(); }
});

async function assertRuntimeFailure(name, injection, fallbackExpected) {
  const report = { reportId: randomUUID(), taskDescription: "Review content for review", summary: "Approved.", status: "approved", findings: [], recommendations: [], metadata: { createdAt: "2026-09-13T00:00:00.000Z", agentVersion: "1.0.0" } };
  const run = await dispatchAndRun(name, JSON.stringify(report), injection);
  try {
    const job = await eventually(async () => (await queue.listJobsByWorkflow(run.workflowId)).find((item) => item.jobId === run.jobId && item.status === "failed"));
    assert.equal(job.attempts, 1);
    assert.equal(run.fetchCalls(), 1);
    // Use only a fresh DB reader for the forensic assertions below.
    const reader = new PostgresPersistence(pool);
    const events = await reader.listExecutionLifecycleEvents(run.recoveryExecutionId);
    assert.ok(events.some((event) => event.state === "RESPONSE_PARSED"));
    assert.ok(events.some((event) => event.state === "VALIDATING"));
    const normal = events.filter((event) => event.state === "FAILED");
    const fallback = await reader.listExecutionFailureFallbackEvents(run.recoveryExecutionId);
    assert.equal(normal.length, fallbackExpected ? 0 : 1);
    assert.equal(fallback.length, fallbackExpected ? 1 : 0);
    const diagnostic = fallbackExpected ? fallback[0].metadata : normal[0].metadata;
    assert.equal(fallbackExpected ? diagnostic.originalFailureClass : diagnostic.errorClassification, "REVIEW_RUNTIME_FAILED");
    assert.equal(diagnostic.runtimeFailureCode, "REVIEW_RUNTIME_FAILED");
    assert.equal(diagnostic.validationStage ?? null, null);
    assert.equal(diagnostic.reviewOutcomeCode ?? null, null);
    assert.equal(JSON.stringify({ events, fallback }).includes(JSON.stringify(report)), false);
    const workflowState = await reader.loadWorkflow(run.workflowId);
    assert.equal(workflowState.state, "FAILED");
    assert.equal(workflowState.steps.find((step) => step.stepId === "visual-human-gate").status, "pending");
    for (const id of ["writer", "seo", "brand"]) assert.equal(workflowState.steps.find((step) => step.stepId === id).attempts, 1);
    assert.equal((await reader.listArtifacts(run.workflowId)).filter((artifact) => artifact.kind === "review_report").length, 0);
    assert.equal(await control.getApproval(`approval-${run.workflowId}-visual-human-gate`), null);
  } finally { await run.stop(); }
}

test("generic post-VALIDATING runtime error is durably classified by the real recovery worker", async () => {
  await assertRuntimeFailure("runtime", "runtime", false);
});

test("wrapped generic post-VALIDATING runtime error retains its durable class", async () => {
  await assertRuntimeFailure("runtime-wrapped", "runtime-wrapped", false);
});

test("generic post-VALIDATING runtime class survives independent terminal fallback", async () => {
  await assertRuntimeFailure("runtime-fallback", "runtime-fallback", true);
});

test("Recovery V2 uses one durable worker-owned production review and reaches pending visual approval", async () => {
  const report = { reportId: randomUUID(), taskDescription: "Review content for review", summary: "The recovered content is ready for the visual approval gate.", status: "approved", findings: [], recommendations: [], metadata: { createdAt: "2026-09-13T00:00:00.000Z", agentVersion: "1.0.0" } };
  const run = await dispatchAndRun("valid", JSON.stringify(report));
  try {
    const pending = await eventually(async () => control.getApproval(`approval-${run.workflowId}-visual-human-gate`));
    assert.equal(pending.status, "PENDING"); assert.equal(run.fetchCalls(), 1);
    const workflowState = await persistence.loadWorkflow(run.workflowId); assert.equal(workflowState.state, "AWAITING_APPROVAL");
    for (const id of ["writer", "seo", "brand"]) assert.equal(workflowState.steps.find((step) => step.stepId === id).attempts, 1, `${id} was not replayed`);
    const reviews = (await persistence.listArtifacts(run.workflowId)).filter((item) => item.kind === "review_report"); assert.equal(reviews.length, 1);
    assert.deepEqual(reviews[0].payload, report);
    assert.equal(pending.agentRecommendation.reviewArtifactId, reviews[0].artifactId);
    assert.equal(pending.agentRecommendation.reviewExecutionId, run.recoveryExecutionId);
    const approvedCommand = (await control.listCommands(`recovery-project-valid`)).find((item) => item.command_id === `command-${run.workflowId}`);
    assert.equal(approvedCommand.status, "REVIEW_APPROVED");
    assert.equal(approvedCommand.visibleResult.reviewArtifactId, reviews[0].artifactId);
    const lifecycle = (await persistence.listExecutionProvenance(run.workflowId)).find((item) => item.executionId === run.recoveryExecutionId);
    assert.equal(lifecycle.status, "success"); assert.equal(lifecycle.configuration.lifecycleState, "COMPLETED"); assert.deepEqual(lifecycle.parentExecutionIds, [run.ambiguousExecutionId, run.originalExecutionId]);
    const events = await persistence.listExecutionLifecycleEvents(run.recoveryExecutionId);
    assert.deepEqual(events.map((event) => event.state), ["READY_FOR_SUBMISSION", "PROVIDER_SUBMISSION_INTENT", "FETCH_INVOCATION_STARTED", "HTTP_RESPONSE_HEADERS_RECEIVED", "HTTP_RESPONSE_BODY_RECEIVED", "RESPONSE_PARSED", "PROVIDER_RESPONSE_RECEIVED", "VALIDATING", "ARTIFACT_PERSISTING", "COMPLETED"]);
    assert.equal(events.at(-1).metadata.visibleContentFingerprint.length, 64); assert.equal(events.at(-1).metadata.responseFingerprint.length, 64);
    // The assertion above is the recovery contract: the real visual gate is
    // pending.  This local fixture-only decision merely lets runLoop finish.
    await control.decideApproval(pending.approvalId, "REJECT", "provider-free fixture teardown");
    assert.equal(await eventually(async () => (await persistence.loadWorkflow(run.workflowId))?.state === "FAILED"), true);
    assert.equal(run.fetchCalls(), 1, "approval teardown cannot replay review/provider transport");
  } finally { await run.stop(); }
});

test("human_review_required Review persists first and reaches one linked pending owner gate", async () => {
  const report = { reportId: randomUUID(), taskDescription: "Review content for review", summary: "Owner decision required.", status: "human_review_required", findings: [], recommendations: [], metadata: { createdAt: "2026-09-13T00:00:00.000Z", agentVersion: "1.0.0" } };
  const run = await dispatchAndRun("human-review", JSON.stringify(report));
  try {
    const pending = await eventually(async () => control.getApproval(`approval-${run.workflowId}-visual-human-gate`));
    assert.equal(pending.status, "PENDING"); assert.equal(run.fetchCalls(), 1);
    const reader = new PostgresPersistence(pool);
    const reviews = (await reader.listArtifacts(run.workflowId)).filter((item) => item.kind === "review_report");
    assert.equal(reviews.length, 1); assert.deepEqual(reviews[0].payload, report);
    const events = await reader.listExecutionLifecycleEvents(run.recoveryExecutionId);
    assert.equal(events.at(-1).state, "COMPLETED");
    assert.equal(pending.agentRecommendation.reviewArtifactId, reviews[0].artifactId);
    assert.equal(pending.agentRecommendation.reviewExecutionId, run.recoveryExecutionId);
    const humanCommand = (await control.listCommands(`recovery-project-human-review`)).find((item) => item.command_id === `command-${run.workflowId}`);
    assert.equal(humanCommand.status, "REVIEW_HUMAN_REVIEW_REQUIRED");
    assert.equal(humanCommand.visibleResult.reviewArtifactId, reviews[0].artifactId);
    assert.equal((await reader.loadWorkflow(run.workflowId)).state, "AWAITING_APPROVAL");
    await control.decideApproval(pending.approvalId, "REJECT", "provider-free fixture teardown");
    await eventually(async () => (await reader.loadWorkflow(run.workflowId))?.state === "FAILED");
    assert.equal(run.fetchCalls(), 1);
  } finally { await run.stop(); }
});

test("artifact invariant validation happens before authorization or job creation", async () => {
  const seeded = await seedRecovery("artifact-preflight");
  const authorizationKey = `artifact-preflight-${seeded.workflowId}`;
  const dispatcher = new PostgresRecoveryDispatcher(pool, persistence);
  await assert.rejects(dispatcher.dispatch({
    authorizationKey, workflowId: seeded.workflowId,
    recoveryOfExecutionId: seeded.ambiguousExecutionId, originalExecutionId: seeded.originalExecutionId,
    recoveryReason: "provider-free artifact invariant", recoveryAuthorization: "OWNER_APPROVED",
    targetStepId: "review", preserveCompletedStepIds: ["writer", "seo", "brand"],
    requiredArtifactsByStep: { writer: { artifactKind: "execution_plan" } },
  }), /RECOVERY_ARTIFACT_INVARIANT_FAILED:writer:execution_plan/);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM workflow_recovery_dispatches WHERE authorization_key=$1", [authorizationKey])).rows[0].count, 0);
  assert.equal((await queue.listJobsByWorkflow(seeded.workflowId)).length, 0);
});

test("orphan failed-dispatch reconciliation preserves history and is exactly idempotent", async () => {
  const seeded = await seedRecovery("orphan-reconcile");
  const authorizationKey = `orphan-reconcile-${seeded.workflowId}`;
  const recoveryExecutionId = randomUUID();
  await pool.query(
    `INSERT INTO workflow_recovery_dispatches
     (authorization_key,workflow_id,submission_key,recovery_execution_id,recovery_of_execution_id,original_execution_id,recovery_reason,authorization_status,job_id,dispatch_status,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'OWNER_APPROVED',NULL,'PENDING',$8)`,
    [authorizationKey, seeded.workflowId, `recovery-source-orphan-reconcile-${seeded.workflowId}`, recoveryExecutionId, seeded.ambiguousExecutionId, seeded.originalExecutionId, "pre-dispatch invariant failure", now()],
  );
  const dispatcher = new PostgresRecoveryDispatcher(pool, persistence);
  const input = {
    authorizationKey, recoveryExecutionId, workflowId: seeded.workflowId,
    errorCode: "RECOVERY_ARTIFACT_INVARIANT_FAILED", reason: "ARTIFACT_ID_SUPPLIED_WHERE_KIND_REQUIRED",
    authorizationRef: "provider-free-test",
  };
  const first = await dispatcher.reconcileOrphanDispatch(input);
  const second = await dispatcher.reconcileOrphanDispatch(input);
  assert.deepEqual(first, { outcome: "RECONCILED", mutated: true, recoveryExecutionId, terminalState: "FAILED_PRE_DISPATCH" });
  assert.deepEqual(second, { outcome: "ALREADY_RECONCILED", mutated: false, recoveryExecutionId, terminalState: "FAILED_PRE_DISPATCH" });
  const row = (await pool.query("SELECT * FROM workflow_recovery_dispatches WHERE authorization_key=$1", [authorizationKey])).rows[0];
  assert.equal(row.dispatch_status, "FAILED_PRE_DISPATCH");
  assert.equal(row.job_id, null);
  assert.equal(row.authorization_status, "OWNER_APPROVED");
  assert.equal(row.reconciliation.orphanDispatch.recoveryExecutionId, recoveryExecutionId);
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM execution_provenance WHERE execution_id=$1", [recoveryExecutionId])).rows[0].count, 0);
  assert.equal((await queue.listJobsByWorkflow(seeded.workflowId)).length, 0);
});
