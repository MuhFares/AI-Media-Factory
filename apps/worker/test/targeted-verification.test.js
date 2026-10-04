import test from "node:test";
import assert from "node:assert/strict";
import { executeTargetedVerification, executeTargetedReevaluationRecovery, WorkflowWorker } from "../dist/index.js";

const oldRows = {
  one: [
    { title: "Ancient Egypt", url: "https://www.britannica.com/place/ancient-Egypt", snippet: "The Nile supported settlement and agriculture." },
    { title: "Egypt collection", url: "https://www.penn.museum/collections/africa/egypt", snippet: "Institutional collection record." },
  ],
  two: [
    { title: "Egyptian section", url: "https://www.penn.museum/about-collections/curatorial-sections/egyptian-section", snippet: "Museum archaeology collection." },
  ],
};

const oldExecution = (candidateId, rows) => ({
  resultId: `web-search-result:verification-${candidateId}-q1`, capabilityId: "web.search", status: "success",
  output: { results: rows }, evidence: { evidenceId: `evidence:verification-${candidateId}-q1`, succeeded: true, providerId: "mock", executedAt: "2026-09-26T00:00:00.000Z" },
});

function payload() {
  return {
    reportId: "11111111-1111-4111-8111-111111111111", taskDescription: "Existing completed Research V2 artifact", summary: "Existing synthesis", confidence: 0.7,
    researchPlan: { missionId: "existing-mission" },
    sources: [
      { id: 1, ...oldRows.one[0] }, { id: 2, ...oldRows.one[1] }, { id: 3, ...oldRows.two[0] },
    ],
    citations: [1, 2, 3].map((sourceId) => ({ sourceId, text: `existing-${sourceId}` })),
    candidateStories: [
      { candidateId: "candidate-1", topic: "A Nile-side perspective on ancient Egypt", factualAngle: "Daily life beside the Nile shaped settlement.", keyClaims: ["The Nile supported settlement and agriculture."], sourceIds: [1, 2], factualVerification: { status: "PARTIAL", basis: "Needs targeted corroboration." }, recommendedForProduction: false },
      { candidateId: "candidate-2", topic: "From Egyptian excavation to museum display", factualAngle: "Excavated objects move through documented museum processes.", keyClaims: ["Museums document Egyptian excavation provenance."], sourceIds: [3], factualVerification: { status: "INCOMPLETE", basis: "Needs a second source." }, recommendedForProduction: false },
    ],
    capabilityExecutions: [oldExecution("candidate-1", oldRows.one), oldExecution("candidate-2", oldRows.two)],
  };
}

const dispatch = {
  dispatchId: "targeted-verification-test", idempotencyKey: "owner:test:targeted-verification", projectId: "morroway",
  workflowId: "wf-1790293235186-1l4105j4", artifactId: "art-wf-1790293235186-1l4105j4-research-20260926T155304378Z",
  selectedCandidateIds: ["candidate-1", "candidate-2"], verificationObjectives: {}, maxVerificationRetrievalCalls: 2,
  maxReevaluationTextCalls: 1, status: "AUTHORIZED", jobId: 1, revisionId: null,
};

function artifact(overrides = {}) {
  return { artifactId: dispatch.artifactId, kind: "research_report", producerAgent: "research", workflowId: dispatch.workflowId,
    correlationId: "existing-research", status: "completed", payload: payload(), contentType: "application/json", schemaVersion: "1.0", createdAt: "2026-09-26T00:00:00.000Z", ...overrides };
}

function harness(options = {}) {
  const events = { requests: [], reservations: [], reconciliations: [], persisted: [], revisions: [] };
  const newRows = {
    "candidate-1": [{ title: "British Museum Egypt", url: "https://www.britishmuseum.org/collection/galleries/egyptian-sculpture", snippet: "Institutional evidence for Nile society." }],
    "candidate-2": [{ title: "Met excavation", url: "https://www.metmuseum.org/about-the-met/collection-areas/egyptian-art", snippet: "Museum collection and excavation context." }],
  };
  const deps = {
    loadArtifact: async () => options.artifact ?? artifact(),
    reserve: async (value) => { events.reservations.push(value); return { reservationId: `reservation-${events.reservations.length}` }; },
    reconcile: async (value) => events.reconciliations.push(value),
    executeCapability: async (request) => {
      events.requests.push(request);
      if (options.preTransportFailure) throw new Error("LOCAL_PREFLIGHT_FAILED");
      await request.onExternalProviderInvocationStarted();
      const candidateId = request.input.candidateId;
      return { status: "success", resultId: `web-search-result:${request.requestId}`, capabilityId: "web.search", output: { results: newRows[candidateId] },
        evidence: { evidenceId: `evidence:${request.requestId}`, succeeded: true, providerId: "mock", executedAt: "2026-09-27T00:00:00.000Z" } };
    },
    persistCapability: async (value) => events.persisted.push(value),
    resolveReevaluationRoute: async () => ({ provider: "openrouter", model: "openai/gpt-6-luna", routingVersionId: "routing-v1", priceSnapshotId: "price-v1", source: "CANONICAL_PRODUCTION_ROUTING" }),
    executeReevaluation: async ({ onTransportEvent }) => {
      await onTransportEvent("FETCH_INVOCATION_STARTED", {});
      if (options.textTransportFailure) throw new Error("MOCK_LLM_TRANSPORT_FAILED");
      return { output: { candidateUpdates: [
        { candidateId: "candidate-1", factualVerification: { status: "STRONG", basis: "Two independent institutional/reputable sources corroborate the existing claim." }, recommendedForProduction: true, supportingSourceUrls: [newRows["candidate-1"][0].url], evidenceRisks: [] },
        { candidateId: "candidate-2", factualVerification: { status: "INCOMPLETE", basis: "The existing claim remains underspecified." }, recommendedForProduction: false, supportingSourceUrls: [newRows["candidate-2"][0].url], evidenceRisks: ["Needs provenance-specific corroboration"] },
      ] }, raw: "{}", usage: { inputTokens: 100, outputTokens: 50, costUsd: 0.001 }, model: "mock", provider: "mock", latencyMs: 1 };
    },
    reviseArtifact: async (value) => { events.revisions.push(value); return { revisionId: "revision-targeted-1" }; },
  };
  return { deps, events };
}

test("A/D/E/F/G/H/I/J/K: provider-free targeted mode is bounded, candidate-isolated, revised, and owner-stopped", async () => {
  const { deps, events } = harness();
  const result = await executeTargetedVerification(dispatch, deps);
  assert.equal(result.retrievalCalls, 2);
  assert.equal(result.textCalls, 1);
  assert.equal(result.directionCalls, 0);
  assert.equal(result.discoveryCalls, 0);
  assert.equal(result.ceoCalls, 0);
  assert.equal(events.requests.length, 2);
  assert.deepEqual(events.requests.map((request) => request.input.candidateId), ["candidate-1", "candidate-2"]);
  assert.equal(events.requests.every((request) => request.input.query.length <= 200), true);
  assert.deepEqual(events.reservations.map((reservation) => reservation.callLeg), ["TARGETED_VERIFICATION_RETRIEVAL", "TARGETED_VERIFICATION_RETRIEVAL", "TARGETED_VERIFICATION_REEVALUATION"]);
  assert.equal(events.reservations.some((reservation) => /DIRECTION|DISCOVERY/.test(reservation.callLeg)), false);
  assert.equal(events.revisions.length, 1);
  const [candidate1, candidate2] = result.output.candidateStories;
  assert.equal(candidate1.topic, "A Nile-side perspective on ancient Egypt");
  assert.equal(candidate2.topic, "From Egyptian excavation to museum display");
  assert.equal(candidate1.recommendedForProduction, true);
  assert.equal(candidate2.recommendedForProduction, false);
  assert.equal(candidate1.factualEligibility, "STRONG");
  assert.equal(candidate2.factualEligibility, "INCOMPLETE");
  assert.equal(candidate1.ceoEligible, true);
  assert.equal(candidate2.ceoEligible, false);
  assert.deepEqual(result.output.ceoEligibleCandidates, ["candidate-1"]);
  assert.equal(candidate1.supportingEvidenceIds.some((id) => String(id).includes("candidate-2")), false);
  assert.equal(candidate2.supportingEvidenceIds.some((id) => String(id).includes("candidate-1")), false);
});

const sourceDispatchId = "targeted-verification-730e3a0bbe2edd5ccaac50bdefcdc1f4";
const recovery = { recoveryId: "targeted-reevaluation-recovery-test", authorizationKey: "owner:recovery:test", sourceDispatchId,
  projectId: "morroway", contentId: "content-mug6d970-jrkufn", workflowId: dispatch.workflowId, artifactId: dispatch.artifactId,
  selectedCandidateIds: ["candidate-1", "candidate-2"], maxReevaluationTextCalls: 1, status: "AUTHORIZED", jobId: 90, revisionId: null };

const recoveredResult = (candidateId, row) => ({ status: "success", resultId: `web-search-result-${sourceDispatchId}:verification-${candidateId}-q1`, capabilityId: "web.search",
  output: { results: [row] }, evidence: { evidenceId: `evidence-web-search-result-${sourceDispatchId}:verification-${candidateId}-q1`, capabilityId: "web.search", workflowId: dispatch.workflowId,
    correlationId: sourceDispatchId, agentId: "research", operation: "search", providerId: "mock", resultCount: 1, executedAt: "2026-09-27T00:00:00.000Z", durationMs: 1, succeeded: true, resultStatus: "success", providerInvoked: true } });

function recoveryHarness(options = {}) {
  const rows = [
    { title: "Institutional Nile source", url: "https://carnegiemnh.org/egypt-and-the-nile/", snippet: "Institutional Nile evidence." },
    { title: "Institutional display source", url: "https://www.metmuseum.org/about-the-met/collection-areas/egyptian-art", snippet: "Institutional museum evidence." },
  ];
  const events = { reserve: [], reconcile: [], revision: [] };
  const results = [recoveredResult("candidate-1", rows[0]), recoveredResult("candidate-2", rows[1])];
  const deps = {
    loadArtifact: async () => artifact(),
    loadPersistedResults: async () => options.results ?? results,
    resolveReevaluationRoute: async () => { if (options.unavailable) throw new Error("CANONICAL_MODEL_UNAVAILABLE"); return { provider: "openrouter", model: "openai/gpt-6-luna", routingVersionId: "amf-balanced-production-routing-v1-morroway", priceSnapshotId: "model-price-luna", source: "CANONICAL_PRODUCTION_ROUTING" }; },
    reserveText: async (value) => { events.reserve.push(value); return { reservationId: "recovery-text-reservation" }; },
    reconcile: async (value) => events.reconcile.push(value),
    executeReevaluation: async ({ route, onTransportEvent }) => { assert.equal(route.model, "openai/gpt-6-luna"); await onTransportEvent("FETCH_INVOCATION_STARTED", {}); return { output: { candidateUpdates: [
      { candidateId: "candidate-1", factualVerification: { status: "STRONG", basis: "Corroborated." }, recommendedForProduction: true, supportingSourceUrls: [rows[0].url], evidenceRisks: [] },
      { candidateId: "candidate-2", factualVerification: { status: "INCOMPLETE", basis: "Still incomplete." }, recommendedForProduction: false, supportingSourceUrls: [rows[1].url], evidenceRisks: ["Object-level provenance missing"] },
    ] }, raw: "{}", usage: { inputTokens: 10, outputTokens: 10, costUsd: 0.001 }, model: route.model, provider: route.provider, latencyMs: 1 }; },
    reviseArtifact: async (value) => { events.revision.push(value); return { revisionId: "targeted-verification-revision-source" }; },
  };
  return { deps, events, results };
}

test("Recovery A/D/G/H/J/K/L/M: reuses two persisted results, reserves only text, revises once, and preserves owner boundary", async () => {
  const { deps, events } = recoveryHarness();
  const result = await executeTargetedReevaluationRecovery(recovery, deps);
  assert.equal(result.retrievalCalls, 0);
  assert.equal(result.retrievalsReused, 2);
  assert.equal(result.textCalls, 1);
  assert.equal(result.route.model, "openai/gpt-6-luna");
  assert.equal(events.reserve.length, 1);
  assert.equal(events.revision.length, 1);
  assert.equal(events.revision[0].repairedPayload.targetedVerificationRecovery.sourceDispatchId, sourceDispatchId);
  assert.equal(events.revision[0].repairedPayload.targetedVerificationRecovery.newRetrievals, 0);
  assert.equal(result.output.candidateStories[0].ceoEligible, true);
  assert.equal(result.output.candidateStories[1].ceoEligible, false);
});

test("Recovery B: candidate-1 evidence cannot attach to candidate-2", async () => {
  const { deps, events } = recoveryHarness();
  // Replace the intentionally awkward fixture after construction so the first
  // candidate receives a result with the wrong identity.
  deps.loadPersistedResults = async () => [recoveredResult("candidate-2", { title: "x", url: "https://example.test/x", snippet: "x" }), recoveredResult("candidate-1", { title: "y", url: "https://example.test/y", snippet: "y" })];
  await assert.rejects(() => executeTargetedReevaluationRecovery(recovery, deps), /EVIDENCE_INTEGRITY_FAILED:candidate-1/);
  assert.equal(events.reserve.length, 0);
});

test("Recovery C: missing persisted evidence fails closed", async () => {
  const { deps, events } = recoveryHarness({ results: [] });
  await assert.rejects(() => executeTargetedReevaluationRecovery(recovery, deps), /RESULT_COUNT_MISMATCH/);
  assert.equal(events.reserve.length, 0);
});

test("Recovery E/F: unavailable canonical model fails before text reservation and consumption", async () => {
  const { deps, events } = recoveryHarness({ unavailable: true });
  await assert.rejects(() => executeTargetedReevaluationRecovery(recovery, deps), /CANONICAL_MODEL_UNAVAILABLE/);
  assert.equal(events.reserve.length, 0);
  assert.equal(events.reconcile.length, 0);
});

test("C: artifact/workflow mismatch fails before reservation", async () => {
  const { deps, events } = harness({ artifact: artifact({ workflowId: "other-workflow" }) });
  await assert.rejects(() => executeTargetedVerification(dispatch, deps), /ARTIFACT_RUNTIME_MISMATCH/);
  assert.equal(events.reservations.length, 0);
});

test("N: pre-transport retrieval failure is released without research consumption", async () => {
  const { deps, events } = harness({ preTransportFailure: true });
  await assert.rejects(() => executeTargetedVerification(dispatch, deps), /LOCAL_PREFLIGHT_FAILED/);
  assert.equal(events.reconciliations.length, 1);
  assert.equal(events.reconciliations[0].transportStarted, false);
});

test("O: reevaluation failure after text transport is attributed once", async () => {
  const { deps, events } = harness({ textTransportFailure: true });
  await assert.rejects(() => executeTargetedVerification(dispatch, deps), /MOCK_LLM_TRANSPORT_FAILED/);
  const textReservation = events.reservations[2];
  const textReconcile = events.reconciliations.find((item) => item.reservationId === "reservation-3");
  assert.equal(textReservation.callKind, "text_agent");
  assert.equal(textReconcile.transportStarted, true);
  assert.equal(textReconcile.success, false);
});

test("A/K: queue worker routes targeted jobs around the workflow engine and preserves bounded ownership", async () => {
  const calls = [];
  const queue = {
    claimNextJob: async () => ({ jobId: 88, workflowId: dispatch.workflowId, submissionKey: "existing-submission", status: "running", attempts: 1, claimedAt: null, error: null, createdAt: "", updatedAt: "" }),
    acknowledge: async (...args) => calls.push(["ack", ...args]),
    recoverOrphanedJobs: async () => 0,
  };
  const worker = new WorkflowWorker({
    queue,
    persistence: {},
    executor: {},
    buildEngine: () => { throw new Error("NORMAL_WORKFLOW_ENGINE_MUST_NOT_RUN"); },
    targetedVerification: {
      byJobId: async (jobId) => { assert.equal(jobId, 88); return dispatch; },
      markRunning: async () => true,
      execute: async () => ({ dispatchId: dispatch.dispatchId, revisionId: "revision-1", retrievalCalls: 2, textCalls: 1, directionCalls: 0, discoveryCalls: 0, ceoCalls: 0, output: {} }),
      settle: async (...args) => calls.push(["settle", ...args]),
    },
  });
  assert.equal(await worker.runOnce(), true);
  assert.deepEqual(calls, [["settle", dispatch.dispatchId, "COMPLETED", "revision-1"], ["ack", 88, "succeeded"]]);
});

test("Recovery A/L/M: queue worker executes only the reevaluation recovery leg", async () => {
  const calls = [];
  const route = { provider: "openrouter", model: "openai/gpt-6-luna", routingVersionId: "amf-balanced-production-routing-v1-morroway", priceSnapshotId: "model-price-luna", source: "CANONICAL_PRODUCTION_ROUTING" };
  const queue = {
    claimNextJob: async () => ({ jobId: 89, workflowId: recovery.workflowId, submissionKey: "existing-submission", status: "running", attempts: 1, claimedAt: null, error: null, createdAt: "", updatedAt: "" }),
    acknowledge: async (...args) => calls.push(["ack", ...args]),
    recoverOrphanedJobs: async () => 0,
  };
  const worker = new WorkflowWorker({
    queue,
    persistence: {},
    executor: {},
    buildEngine: () => { throw new Error("NORMAL_WORKFLOW_ENGINE_MUST_NOT_RUN"); },
    targetedReevaluationRecovery: {
      byJobId: async (jobId) => { assert.equal(jobId, 89); return recovery; },
      markRunning: async () => true,
      execute: async () => ({ recoveryId: recovery.recoveryId, revisionId: "recovery-revision-1", retrievalCalls: 0, retrievalsReused: 2, textCalls: 1, route, output: {} }),
      settle: async (...args) => calls.push(["settle", ...args]),
    },
  });
  assert.equal(await worker.runOnce(), true);
  assert.deepEqual(calls, [["settle", recovery.recoveryId, "COMPLETED", "recovery-revision-1", undefined, route], ["ack", 89, "succeeded"]]);
});
