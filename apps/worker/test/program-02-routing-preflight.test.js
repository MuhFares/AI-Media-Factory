import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GovernedAgentRuntime } from "../dist/governed-agent-runtime.js";
import { createStrategyCouncilV2SpecialistAgent, STRATEGY_COUNCIL_V2_EXAMPLES } from "../dist/strategy-council-v2-specialists.js";

const response = (output, model = "project-model") => ({
  provider: "openrouter", model, output, raw: {}, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2, costUsd: 0 },
});

function persistence() {
  const artifacts = [];
  return {
    artifacts,
    async saveArtifact(value) { artifacts.push(value); },
    async listArtifacts(workflowId) { return artifacts.filter((item) => item.workflowId === workflowId); },
  };
}

test("governed Command Room preflight blocks transport and persists complete provenance", async () => {
  let transports = 0;
  const store = persistence();
  const blocked = new GovernedAgentRuntime(store, async () => { transports += 1; return response({}); }, async () => { throw new Error("LLM_PREFLIGHT_FAILED:MODEL_UNAVAILABLE"); });
  const request = { workflowId: "w", projectId: "project-2", agentId: "research", prompt: "research topic", config: { provider: "openrouter", model: "project-model", source: "PROJECT", routingVersionId: "rv-2", routingScope: "PROJECT", priceSnapshotId: "ps-2" } };
  const denied = await blocked.executeGovernedAgent(request);
  assert.equal(denied.status, "BLOCKED"); assert.equal(transports, 0); assert.equal(store.artifacts.length, 0);

  const allowed = new GovernedAgentRuntime(store, async () => { transports += 1; return response({ concept: "c", historicalAngle: "h", evidenceConsiderations: ["e"], sourceability: "s", risks: ["r"], recommendation: "hold" }); }, async (input) => {
    assert.equal(input.projectId, "project-2"); assert.equal(input.routingVersionId, "rv-2");
    return { fingerprint: "fingerprint-2" };
  });
  const completed = await allowed.executeGovernedAgent(request);
  assert.equal(completed.status, "COMPLETED"); assert.equal(transports, 1);
  assert.equal(completed.provenance.routingVersionId, "rv-2");
  assert.equal(completed.provenance.priceSnapshotId, "ps-2");
  assert.equal(completed.provenance.preflightFingerprint, "fingerprint-2");
});

test("Strategy Council specialist requires an explicit canonical route", async () => {
  let transports = 0;
  const execute = async (_context, request) => { transports += 1; assert.equal(request.model, "project-model"); return response(STRATEGY_COUNCIL_V2_EXAMPLES.brand); };
  const agent = createStrategyCouncilV2SpecialistAgent("brand", execute);
  await assert.rejects(agent.executeAgent({ context: {}, input: { objective: "x", validatedArtifacts: [] } }, {}), /CANONICAL_SPECIALIST_ROUTE_REQUIRED/);
  assert.equal(transports, 0);
  const result = await agent.executeAgent({ context: {}, input: { objective: "x", validatedArtifacts: [{ artifactId: "a", kind: "research_report", producerAgent: "research", payload: {} }], controlAgentOverrides: { brand: { provider: "openrouter", model: "project-model", canonicalRouting: { routingVersionId: "rv", priceSnapshotId: "ps" } } } } }, {});
  assert.equal(transports, 1); assert.equal(result.response.model, "project-model");
});

test("branded production code has no Morroway-only or governed ambient fallback", async () => {
  const executor = await readFile(new URL("../src/production-executor.ts", import.meta.url), "utf8");
  const worker = await readFile(new URL("../src/worker.ts", import.meta.url), "utf8");
  const bootstrap = await readFile(new URL("../src/production-worker.ts", import.meta.url), "utf8");
  const command = worker.slice(worker.indexOf("private async processGovernedCommand"));
  assert.doesNotMatch(executor, /project\s*!==\s*["']morroway["']/i);
  assert.doesNotMatch(command, /OPENROUTER_DEFAULT_MODEL|AGENT_ROUTER_DEFAULT_MODEL|gpt-5\.6-sol/);
  assert.match(bootstrap, /ProductionModelRoutingStore/);
  assert.match(bootstrap, /preflightGovernedCommand/);
});

test("targeted reevaluation recovery stays canonical and retrieval-free", async () => {
  const source = await readFile(new URL("../src/targeted-verification.ts", import.meta.url), "utf8");
  const recovery = source.slice(source.indexOf("createProductionTargetedReevaluationRecoveryRuntime"));
  assert.match(recovery, /routing\.preflight\("research"/);
  assert.doesNotMatch(recovery, /nex-agi\/nex-n2\.5-pro:free/);
  assert.match(source, /retrievalCalls:0/);
});

test("current source and dist both contain universal preflight wiring", async () => {
  const source = await readFile(new URL("../src/production-worker.ts", import.meta.url), "utf8");
  const dist = await readFile(new URL("../dist/production-worker.js", import.meta.url), "utf8");
  assert.match(source, /preflightGovernedCommand/); assert.match(dist, /preflightGovernedCommand/);
});
