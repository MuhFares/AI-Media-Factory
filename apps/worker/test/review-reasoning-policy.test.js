import { test, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { createProductionAgentExecutor, modelRequiresReasoning, modelSupportsReasoningNone } from "../dist/index.js";

const originalFetch = global.fetch;
const originalProvider = process.env.TEXT_AGENT_PROVIDER;
const originalBaseUrl = process.env.OPENROUTER_BASE_URL;
const originalApiKey = process.env.OPENROUTER_API_KEY;
const originalDefaultModel = process.env.OPENROUTER_DEFAULT_MODEL;

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

const V3 = { executionId: "9abbeeab-6cc7-4345-96ad-8fba43dcea8a", parentId: "41559884-52e8-4d94-b027-25bc1857defd", originalId: "8467ccfb-e4c3-429e-8476-00438ad66c2d" };
async function seedReviewGuard(store, model) {
  const workflowId = "wf-reasoning-policy", correlationId = "corr-reasoning-policy";
  for (const [artifactId, kind, producerAgent, payload] of [["writer-rp", "writer_report", "writer", { title: "title", content: "content" }], ["seo-rp", "seo_report", "seo", { optimizedTitle: "title" }], ["brand-rp", "brand_report", "brand", { status: "approved" }]]) {
    await store.saveArtifact({ artifactId, kind, workflowId, correlationId, producerAgent, status: "completed", createdAt: new Date().toISOString(), payload });
  }
  const record = (executionId, lifecycleState) => ({ executionId, workflowId, correlationId, agentId: "review", stage: "review", capability: "agent.execute", provider: "openrouter", model, runtime: "governed-openrouter-llm", promptVersion: null, configurationFingerprint: null, startedAt: new Date().toISOString(), completedAt: new Date().toISOString(), latencyMs: 0, status: "blocked", usage: null, costKind: "UNKNOWN", cost: null, currency: "USD", artifactIds: [], parentExecutionIds: [], attemptNumber: 1, providerRequestId: null, providerJobId: null, errorClassification: null, configuration: { lifecycleState } });
  await store.saveExecutionProvenance({ ...record(V3.executionId, "READY_FOR_SUBMISSION"), parentExecutionIds: [V3.parentId, V3.originalId], configuration: { lifecycleState: "READY_FOR_SUBMISSION", recoveryExecution: { recoveryOfExecutionId: V3.parentId, originalExecutionId: V3.originalId, recoveryAuthorization: "OWNER_APPROVED" } } });
  await store.saveExecutionProvenance(record(V3.parentId, "VALIDATING"));
  return { workflowId, correlationId, context: { workflowId, correlationId, data: { recoveryExecution: { recoveryOfExecutionId: V3.parentId, originalExecutionId: V3.originalId, recoveryAuthorization: "OWNER_APPROVED" }, controlAgentOverrides: { review: { provider: "openrouter", model } } } } };
}

function useOpenRouter() {
  process.env.TEXT_AGENT_PROVIDER = "openrouter";
  process.env.OPENROUTER_API_KEY = "test";
  process.env.OPENROUTER_BASE_URL = "https://mock.invalid/api/v1";
}
function restoreEnv() {
  global.fetch = originalFetch;
  if (originalProvider === undefined) delete process.env.TEXT_AGENT_PROVIDER; else process.env.TEXT_AGENT_PROVIDER = originalProvider;
  if (originalBaseUrl === undefined) delete process.env.OPENROUTER_BASE_URL; else process.env.OPENROUTER_BASE_URL = originalBaseUrl;
  if (originalApiKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = originalApiKey;
  if (originalDefaultModel === undefined) delete process.env.OPENROUTER_DEFAULT_MODEL; else process.env.OPENROUTER_DEFAULT_MODEL = originalDefaultModel;
}

test("model reasoning capability policy is evidence-backed and variant-aware", () => {
  assert.equal(modelRequiresReasoning("openai/gpt-oss-20b"), true);
  assert.equal(modelRequiresReasoning("openai/gpt-oss-20b:free"), true);
  assert.equal(modelRequiresReasoning("  OpenAI/GPT-OSS-20B  "), true);
  assert.equal(modelRequiresReasoning("inclusionai/ling-3.0-flash"), false);
  assert.equal(modelRequiresReasoning("openai/gpt-oss-120b"), false);
  assert.equal(modelSupportsReasoningNone("openai/gpt-oss-20b"), false);
  assert.equal(modelSupportsReasoningNone("inclusionai/ling-3.0-flash"), true);
});

test("A. review on a reasoning-mandatory model omits reasoning:none", async () => {
  const store = new Store();
  const seeded = await seedReviewGuard(store, "openai/gpt-oss-20b");
  let submitted = null, calls = 0;
  useOpenRouterMock400((url, options) => { calls += 1; submitted = JSON.parse(options.body); });
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review", agent: "review" }, seeded.context);
    assert.equal(outcome.status, "failed");
    assert.equal(calls, 1);
    assert.equal(submitted.model, "openai/gpt-oss-20b");
    assert.ok(!("reasoning" in submitted), "reasoning key must be absent for reasoning-mandatory models");
    assert.equal(submitted.response_format.type, "json_schema");
  } finally { restoreEnv(); }
});

function useOpenRouterMock400(impl) {
  useOpenRouter();
  global.fetch = impl;
}

test("B. review on a permissive model keeps reasoning:none", async () => {
  const store = new Store();
  const seeded = await seedReviewGuard(store, "inclusionai/ling-3.0-flash");
  let submitted = null;
  useOpenRouter();
  global.fetch = async (_url, options) => { submitted = JSON.parse(options.body); return new Response(JSON.stringify({ error: { message: "inert", code: 400 } }), { status: 400 }); };
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review", agent: "review" }, seeded.context);
    assert.equal(outcome.status, "failed");
    assert.deepEqual(submitted.reasoning, { effort: "none" });
    assert.equal(submitted.model, "inclusionai/ling-3.0-flash");
  } finally { restoreEnv(); }
});

test("C+D. structured-output contract unchanged; canonical model kept; single submit", async () => {
  const store = new Store();
  const seeded = await seedReviewGuard(store, "openai/gpt-oss-20b");
  let submitted = null, calls = 0;
  useOpenRouter();
  global.fetch = async (_url, options) => { calls += 1; submitted = JSON.parse(options.body); return new Response(JSON.stringify({ error: { message: "inert", code: 400 } }), { status: 400 }); };
  try {
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "review", agent: "review" }, seeded.context);
    assert.equal(outcome.status, "failed");
    assert.equal(submitted.response_format.type, "json_schema");
    assert.equal(submitted.response_format.json_schema.strict, false);
    assert.equal(submitted.response_format.json_schema.name, "amf_structured_response");
    assert.ok(typeof submitted.response_format.json_schema.schema === "object");
    assert.equal(submitted.model, "openai/gpt-oss-20b");
    assert.equal(calls, 1);
    const failed = store.lifecycleEvents.filter((e) => e.state === "FAILED").at(-1);
    assert.equal(failed.metadata.providerErrorBody, JSON.stringify({ error: { message: "inert", code: 400 } }));
  } finally { restoreEnv(); }
});
