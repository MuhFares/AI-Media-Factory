import test from "node:test";
import assert from "node:assert/strict";
import { createProductionAgentExecutor } from "../dist/production-executor.js";

class Store {
  artifacts = new Map();
  provenance = new Map();
  lifecycleEvents = [];
  async saveArtifact(value) { this.artifacts.set(value.artifactId, structuredClone(value)); }
  async listArtifacts() { return [...this.artifacts.values()].map((value) => structuredClone(value)); }
  async saveExecutionProvenance(value) { this.provenance.set(value.executionId, structuredClone(value)); }
  async listExecutionProvenance() { return [...this.provenance.values()].map((value) => structuredClone(value)); }
  async claimReadyExecutionProvenance(executionId, details = {}) {
    const current = this.provenance.get(executionId);
    if (current?.configuration?.lifecycleState !== "READY_FOR_SUBMISSION") return false;
    current.configuration = { ...current.configuration, lifecycleState: "PROVIDER_SUBMISSION_INTENT", lifecycleDetails: { providerSubmissionStarted: true, maxTokens: details.maxTokens ?? null } };
    this.provenance.set(executionId, structuredClone(current));
    return true;
  }
  async appendExecutionLifecycleEvent(event) { this.lifecycleEvents.push(structuredClone(event)); }
  async listExecutionLifecycleEvents() { return this.lifecycleEvents.map((event) => structuredClone(event)); }
}

const originalFetch = global.fetch;
const originalProvider = process.env.TEXT_AGENT_PROVIDER;
const originalBaseUrl = process.env.OPENROUTER_BASE_URL;
const originalApiKey = process.env.OPENROUTER_API_KEY;

function context() {
  return { workflowId: "wf-error-body", correlationId: "corr-error-body", data: { projectId: "morroway", productionPhase: "PRE_MEDIA_PHASE", mediaAuthority: "NOT_GRANTED" } };
}
function deps() {
  const routing = { resolve: async () => ({ provider: "openrouter", model: "openai/gpt-oss-20b", requestedModel: "openai/gpt-oss-20b", resolvedModel: "openai/gpt-oss-20b", routingVersionId: "route-v1", routingScope: "PROJECT", projectId: "morroway", role: "orchestrator", profile: "BALANCED", priceSnapshotId: "price-v1", fallbackUsed: false, fallbackReason: null }), preflight: async () => ({ availabilityState: "AVAILABLE", liveHealthState: "HEALTHY", configurationFingerprint: "fixture", code: "PASS" }) };
  const budget = { reserve: async (input) => ({ reservationId: `reservation-${input.callKind}`, callKind: input.callKind }), reconcile: async () => {} };
  return { persistence: new Store(), modelRouting: routing, productionCallBudget: budget };
}
function useOpenRouterMock(fetchImpl) {
  process.env.TEXT_AGENT_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test";
  process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
  global.fetch = fetchImpl;
}
function restore() {
  global.fetch = originalFetch;
  if (originalProvider === undefined) delete process.env.TEXT_AGENT_PROVIDER; else process.env.TEXT_AGENT_PROVIDER = originalProvider;
  if (originalBaseUrl === undefined) delete process.env.OPENROUTER_BASE_URL; else process.env.OPENROUTER_BASE_URL = originalBaseUrl;
  if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalApiKey;
}

test("OpenRouter 400 retains the bounded provider error body without changing message or retry behavior", async () => {
  const d = deps();
  const body = JSON.stringify({ error: { message: "Response schema is not supported: oneOf", code: 400, param: "response_format" } });
  let calls = 0;
  useOpenRouterMock(async () => { calls += 1; return new Response(body, { status: 400 }); });
  try {
    const outcome = await createProductionAgentExecutor({ persistence: d.persistence, modelRouting: d.modelRouting, productionCallBudget: d.productionCallBudget }).executeAgentStep({ id: "orchestrator", agent: "orchestrator" }, context());
    assert.equal(outcome.status, "failed");
    assert.equal(d.persistence.artifacts.size, 0);
    assert.equal(outcome.error.message, "OpenRouter request failed (400)");
    assert.equal(calls, 1);
    const failed = d.persistence.lifecycleEvents.filter((e) => e.state === "FAILED").at(-1);
    assert.equal(failed.metadata.failureMessage, "OpenRouter request failed (400)");
    assert.equal(failed.metadata.httpStatus, 400);
    assert.equal(failed.metadata.providerErrorBody, body);
  } finally { restore(); }
});

test("OpenRouter 400 with empty body records null and still fails closed once", async () => {
  const d = deps();
  let calls = 0;
  useOpenRouterMock(async () => { calls += 1; return new Response("", { status: 400 }); });
  try {
    const outcome = await createProductionAgentExecutor({ persistence: d.persistence, modelRouting: d.modelRouting, productionCallBudget: d.productionCallBudget }).executeAgentStep({ id: "orchestrator", agent: "orchestrator" }, context());
    assert.equal(outcome.status, "failed");
    assert.equal(outcome.error.message, "OpenRouter request failed (400)");
    assert.equal(calls, 1);
    const failed = d.persistence.lifecycleEvents.filter((e) => e.state === "FAILED").at(-1);
    assert.equal(failed.metadata.providerErrorBody, null);
  } finally { restore(); }
});

test("OpenRouter 400 with oversized body truncates retention at 2000 chars", async () => {
  const d = deps();
  useOpenRouterMock(async () => new Response("x".repeat(5000), { status: 400 }));
  try {
    const outcome = await createProductionAgentExecutor({ persistence: d.persistence, modelRouting: d.modelRouting, productionCallBudget: d.productionCallBudget }).executeAgentStep({ id: "orchestrator", agent: "orchestrator" }, context());
    assert.equal(outcome.status, "failed");
    const failed = d.persistence.lifecycleEvents.filter((e) => e.state === "FAILED").at(-1);
    assert.equal(failed.metadata.providerErrorBody, "x".repeat(2000));
  } finally { restore(); }
});
