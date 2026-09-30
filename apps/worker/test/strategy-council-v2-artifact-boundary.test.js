import test from "node:test";
import assert from "node:assert/strict";
import { createProductionAgentExecutor } from "../dist/production-executor.js";
import { STRATEGY_COUNCIL_V2_EXAMPLES, validateStrategyCouncilSpecialistV2 } from "../dist/strategy-council-v2-specialists.js";
import { STRATEGY_COUNCIL_V2_EXAMPLE, validateStrategyCouncilSynthesisV2 } from "@ai-media-factory/ceo-agent";

const original = { fetch: global.fetch, provider: process.env.TEXT_AGENT_PROVIDER, base: process.env.ANTHROPIC_BASE_URL, token: process.env.ANTHROPIC_AUTH_TOKEN };

class Store {
  artifacts = new Map(); provenance = new Map(); events = []; failSave = false; hideReload = false;
  async saveArtifact(value) { this.events.push("artifact:save"); if (this.failSave) throw new Error("database detail must be bounded"); this.artifacts.set(value.artifactId, structuredClone(value)); }
  async listArtifacts() { this.events.push("artifact:list"); return this.hideReload && this.events.includes("artifact:save") ? [] : [...this.artifacts.values()].map((value) => structuredClone(value)); }
  async saveExecutionProvenance(value) { this.events.push(`provenance:${value.status}:${value.configuration?.lifecycleState}`); this.provenance.set(value.executionId, structuredClone(value)); }
  async listExecutionProvenance() { return [...this.provenance.values()].map((value) => structuredClone(value)); }
  async claimReadyExecutionProvenance(executionId) {
    const value = this.provenance.get(executionId);
    if (value?.configuration?.lifecycleState !== "READY_FOR_SUBMISSION") return false;
    value.configuration.lifecycleState = "PROVIDER_SUBMISSION_INTENT";
    value.configuration.providerSubmissionStarted = true;
    this.provenance.set(executionId, structuredClone(value));
    return true;
  }
}

function seedPlanner(store) {
  store.artifacts.set("planner", { artifactId: "planner", kind: "evidence_backed_content_brief", producerAgent: "planner", workflowId: "wf-envelope", correlationId: "corr-envelope", status: "completed", contentType: "application/json", schemaVersion: "1", createdAt: "2026-09-07T00:00:00.000Z", payload: { objective: "Neutral fixture", recommendedApproach: "Bounded plan" } });
}

function configure() {
  process.env.TEXT_AGENT_PROVIDER = "agentrouter";
  process.env.ANTHROPIC_BASE_URL = "https://agentrouter.test";
  process.env.ANTHROPIC_AUTH_TOKEN = "test-secret";
}
function restore() { global.fetch = original.fetch; process.env.TEXT_AGENT_PROVIDER = original.provider; process.env.ANTHROPIC_BASE_URL = original.base; process.env.ANTHROPIC_AUTH_TOKEN = original.token; }
function context(model = "claude-opus-4-8") { return { workflowId: "wf-envelope", correlationId: "corr-envelope", data: { strategyMode: "PRE_PUBLICATION_STRATEGY", agentRouterModelOverride: model, objective: "Neutral local envelope fixture", validatedArtifacts: [] } }; }
function response(payload) { return new Response(JSON.stringify({ type: "message", model: "claude-opus-4-8", stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(payload) }], usage: { input_tokens: 10, output_tokens: 20 } }), { status: 200, headers: { "request-id": "fixture-request" } }); }

for (const agent of ["writer", "seo", "brand", "growth", "finance"]) {
  test(`${agent} V2 strict payload survives the real executor artifact round trip`, async () => {
    configure(); const store = new Store(); seedPlanner(store); const fixture = structuredClone(STRATEGY_COUNCIL_V2_EXAMPLES[agent]); global.fetch = async () => response(fixture);
    try {
      const ctx = context();
      const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: `${agent}-envelope-fixture`, agent }, ctx);
      assert.equal(outcome.status, "completed", outcome.error?.message);
      assert.deepEqual(outcome.output, fixture);
      assert.equal(Object.isFrozen(outcome.output), true);
      assert.equal(Object.hasOwn(outcome.output, "agentExecution"), false);
      assert.deepEqual(outcome.artifact.payload, fixture);
      assert.deepEqual(validateStrategyCouncilSpecialistV2(agent, outcome.artifact.payload), fixture);
      const persisted = store.artifacts.get(outcome.artifact.artifactId);
      assert.deepEqual(persisted.payload, fixture);
      assert.equal(persisted.kind, `strategy_council_${agent}_v2`);
      const record = [...store.provenance.values()].at(-1);
      assert.equal(record.status, "success"); assert.equal(record.configuration.lifecycleState, "COMPLETED");
      assert.deepEqual(record.artifactIds, [outcome.artifact.artifactId]);
      assert.ok(store.events.lastIndexOf("artifact:list") < store.events.lastIndexOf("provenance:success:COMPLETED"));
      assert.deepEqual(ctx.data.previousArtifact, { artifactId: outcome.artifact.artifactId, kind: outcome.artifact.kind });
    } finally { restore(); }
  });
}

test("V2 artifact persistence failure cannot complete or create a prospective context reference", async () => {
  configure(); const store = new Store(); seedPlanner(store); store.failSave = true; global.fetch = async () => response(STRATEGY_COUNCIL_V2_EXAMPLES.writer);
  try {
    const ctx = context(); const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "writer-persistence-failure", agent: "writer" }, ctx);
    assert.equal(outcome.status, "failed"); assert.equal(outcome.artifact, undefined); assert.equal(ctx.data.previousArtifact, undefined); assert.equal(store.artifacts.size, 1);
    const record = [...store.provenance.values()].at(-1); assert.equal(record.status, "failed"); assert.equal(record.configuration.lifecycleState, "ARTIFACT_PERSISTENCE_FAILED"); assert.deepEqual(record.artifactIds, []);
  } finally { restore(); }
});

test("V2 artifact reload failure cannot complete or become canonical", async () => {
  configure(); const store = new Store(); seedPlanner(store); store.hideReload = true; global.fetch = async () => response(STRATEGY_COUNCIL_V2_EXAMPLES.writer);
  try {
    const ctx = context(); const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "writer-reload-failure", agent: "writer" }, ctx);
    assert.equal(outcome.status, "failed"); assert.equal(outcome.artifact, undefined); assert.equal(ctx.data.previousArtifact, undefined);
    const record = [...store.provenance.values()].at(-1); assert.equal(record.status, "failed"); assert.equal(record.configuration.lifecycleState, "ARTIFACT_RELOAD_VALIDATION_FAILED"); assert.deepEqual(record.artifactIds, []);
  } finally { restore(); }
});

test("CEO V2 strict payload survives the real executor artifact round trip", async () => {
  configure(); const store = new Store();
  for (const agent of ["research", "planner", "writer", "seo", "brand", "growth", "finance"]) store.artifacts.set(agent, { artifactId: agent, kind: `strategy_council_${agent}_v2`, producerAgent: agent, workflowId: "wf-envelope", correlationId: "corr-envelope", status: "completed", contentType: "application/json", schemaVersion: "1", createdAt: "2026-09-07T00:00:00.000Z", payload: { bounded: true } });
  const fixture = structuredClone(STRATEGY_COUNCIL_V2_EXAMPLE); global.fetch = async () => response(fixture);
  try {
    const ctx = context(); ctx.data.strategyCouncilArtifactIds = ["research", "planner", "writer", "seo", "brand", "growth", "finance"];
    const outcome = await createProductionAgentExecutor({ persistence: store }).executeAgentStep({ id: "ceo-envelope-fixture", agent: "ceo" }, ctx);
    assert.equal(outcome.status, "completed", outcome.error?.message); assert.deepEqual(outcome.output, fixture); assert.equal(Object.hasOwn(outcome.output, "agentExecution"), false);
    assert.deepEqual(validateStrategyCouncilSynthesisV2(outcome.artifact.payload), fixture); assert.equal(outcome.artifact.kind, "strategy_council_ceo_v2");
    assert.deepEqual(store.artifacts.get(outcome.artifact.artifactId).payload, fixture);
  } finally { restore(); }
});

test("ordinary production payload enrichment remains backward compatible", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("../src/production-executor.ts", import.meta.url), "utf8"));
  assert.match(source, /strictCouncilPayload[\s\S]*?agentExecution:/);
  assert.match(source, /buildArtifact\(step, context, output, status, !strictCouncilPayload\)/);
});
