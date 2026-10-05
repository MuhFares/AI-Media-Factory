/**
 * Provider-free Research per-leg model routing matrix. No network.
 * The worker dispatches transports by leg; the agent labels requests by leg.
 * This suite proves the agent side: request.model per leg, legacy default,
 * unknown-key tolerance, and request construction.
 */
import { describe, it } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { createResearchAgent } from "../dist/index.js";

const task = {
  id: "research-research",
  name: "Research",
  description: "Production research for probe factual candidates with Morroway research context.",
  agent: "research",
  inputSchema: {},
  outputSchema: {},
  dependencies: [],
};
const contract = { taskId: "research-research", stage: "research" };
const EVIDENCE = [
  { title: "Suhaymi fixture", url: "https://example.test/suhaymi", snippet: "Documented fixture.", source: "example.test", rank: 1 },
];
const signal = { isCancelled: false, onCancelled() {}, throwIfCancelled() {} };

function synthesisOutput() {
  return {
    reportId: "11111111-1111-4111-8111-111111111111",
    taskId: "research-research",
    stage: "research",
    taskDescription: "Probe synthesis of Morroway factual candidates from retrieved evidence.",
    summary: "One dated candidate with field-survey provenance.",
    candidateStories: [{
      candidateId: "candidate-1", topic: "Bayt al-Suhaymi", factualAngle: "Ottoman domestic architecture",
      keyClaims: ["Mashrabiya screens shade the courtyard"], sourceIds: [1], supportingEvidenceIds: ["ev-probe"],
      sourceQualitySummary: "Field survey", visualPotential: "Courtyard footage", shortFormPotential: "30-second reveal",
      evidenceRisks: [], verificationStatus: "needs-verification",
      contentOpportunityAssessment: { level: "HIGH", basis: "Evergreen discovery" },
      factualVerification: { status: "STRONG", basis: "Institutional corroboration" },
      recommendedForProduction: true,
    }],
    sources: [{ id: 1, title: "Suhaymi fixture", url: "https://example.test/suhaymi", snippet: "Documented fixture." }],
    confidence: 0.8,
    citations: [{ sourceId: 1, text: "Documented fixture." }],
    evidenceRisks: ["Single-source coverage."],
    status: "grounded",
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
}

function planOutput() {
  return {
    reportId: "00000000-0000-4000-8000-000000000000",
    taskId: "research-research",
    stage: "research",
    taskDescription: "Probe research for Morroway factual candidates.",
    summary: "Probe plan awaiting retrieval.",
    sources: [],
    confidence: 0.1,
    citations: [],
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
}

function trackingExecute(calls, outputFor) {
  return async (_ctx, request) => {
    calls.push({ leg: request?.callIdentity?.callLeg ?? null, model: request?.model ?? null, request });
    const leg = request?.callIdentity?.callLeg;
    const output = leg === "FINAL_SYNTHESIS" ? outputFor() : planOutput();
    return { output, raw: "{}", usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.00001 }, model: "test", provider: "test", latencyMs: 1 };
  };
}

function stubBoundary() {
  return {
    async executeCapability(request) {
      return {
        status: "success",
        resultId: `result-${request.requestId}`,
        capabilityId: request.capabilityId,
        output: { results: EVIDENCE, providerId: "probe" },
        evidence: { providerId: "probe", evidenceId: "ev-probe", succeeded: true, executedAt: "2026-09-25T00:00:00.000Z" },
      };
    },
  };
}

function baseInput() {
  return {
    task,
    contract,
    synthesisContract: "amf-research-synthesis-v1",
    capabilityRequests: [{ requestId: "cap-1", capabilityId: "web.search", agentId: "research", workflowId: "wf-1", correlationId: "corr-1", input: { query: "probe", maxResults: 5 }, requestedAt: "2026-09-25T00:00:00.000Z" }],
  };
}

function agentWith(config, calls) {
  return createResearchAgent({
    config: { model: "luna-model", ...config },
    execute: trackingExecute(calls, synthesisOutput),
    capabilityExecution: stubBoundary(),
  });
}

describe("research per-leg routing", () => {
  it("A. legacy config without leg maps labels every leg with the default model", async () => {
    const calls = [];
    const result = await agentWith({}, calls).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
    ok(calls.length >= 2);
    for (const call of calls) strictEqual(call.model, "luna-model");
    deepStrictEqual(calls.map((c) => c.leg).sort(), ["DIRECTION", "FINAL_SYNTHESIS"]);
  });

  it("B. synthesis-only map labels only FINAL_SYNTHESIS with the leg model", async () => {
    const calls = [];
    const result = await agentWith({ modelForLeg: { FINAL_SYNTHESIS: "nemo-model" } }, calls).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
    strictEqual(calls.length, 2);
    const byLeg = Object.fromEntries(calls.map((c) => [c.leg, c.model]));
    strictEqual(byLeg.DIRECTION, "luna-model");
    strictEqual(byLeg.FINAL_SYNTHESIS, "nemo-model");
  });

  it("C. direction-only map labels only DIRECTION, synthesis keeps legacy", async () => {
    const calls = [];
    const result = await agentWith({ modelForLeg: { DIRECTION: "other-model" } }, calls).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
    const byLeg = Object.fromEntries(calls.map((c) => [c.leg, c.model]));
    strictEqual(byLeg.DIRECTION, "other-model");
    strictEqual(byLeg.FINAL_SYNTHESIS, "luna-model");
  });

  it("D. unknown leg keys are ignored, known legs keep working", async () => {
    const calls = [];
    const result = await agentWith({ modelForLeg: { NO_SUCH_LEG: "x-model", FINAL_SYNTHESIS: "nemo-model" } }, calls).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
    const byLeg = Object.fromEntries(calls.map((c) => [c.leg, c.model]));
    strictEqual(byLeg.FINAL_SYNTHESIS, "nemo-model");
    strictEqual(byLeg.DIRECTION, "luna-model");
  });

  it("E. blank leg model value falls back to the default model", async () => {
    const calls = [];
    const result = await agentWith({ modelForLeg: { FINAL_SYNTHESIS: "   " } }, calls).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
    for (const call of calls) strictEqual(call.model, "luna-model");
  });

  it("F. synthesis request carries the leg model with floor budget and strict schema", async () => {
    const calls = [];
    const result = await agentWith({ modelForLeg: { FINAL_SYNTHESIS: "mistralai/mistral-nemo" } }, calls).execute({ context: {}, input: baseInput() }, signal);
    strictEqual(result.output.status, "grounded");
    const synthesis = calls.filter((c) => c.leg === "FINAL_SYNTHESIS");
    const direction = calls.filter((c) => c.leg === "DIRECTION");
    strictEqual(synthesis.length, 1);
    strictEqual(synthesis[0].model, "mistralai/mistral-nemo");
    ok(synthesis[0].request.maxOutputTokens >= 8192);
    strictEqual("reasoning" in synthesis[0].request, false);
    deepStrictEqual(synthesis[0].request.responseSchema.properties.status.enum, ["grounded", "insufficient_evidence"]);
    strictEqual(direction.length, 1);
    strictEqual(direction[0].model, "luna-model");
  });
});
