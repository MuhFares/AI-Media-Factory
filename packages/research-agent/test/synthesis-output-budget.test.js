/** Provider-free synthesis output-budget floor contract. No network. */
import { describe, it } from "node:test";
import { strictEqual } from "node:assert";
import { createResearchAgent, FINAL_SYNTHESIS_MIN_OUTPUT_TOKENS } from "../dist/index.js";

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
  { title: "Ibn Tulun fixture", url: "https://example.test/tulun", snippet: "Documented fixture.", source: "example.test", rank: 1 },
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
      candidateId: "candidate-1", topic: "Ibn Tulun Mosque", factualAngle: "Tulunid engineering",
      keyClaims: ["Open courtyard with spiral minaret"], sourceIds: [1], supportingEvidenceIds: ["ev-probe"],
      sourceQualitySummary: "Field survey", visualPotential: "Courtyard footage", shortFormPotential: "30-second reveal",
      evidenceRisks: [], verificationStatus: "needs-verification",
      contentOpportunityAssessment: { level: "HIGH", basis: "Evergreen discovery" },
      factualVerification: { status: "STRONG", basis: "Institutional corroboration" },
      recommendedForProduction: true,
    }],
    sources: [{ id: 1, title: "Ibn Tulun fixture", url: "https://example.test/tulun", snippet: "Documented fixture." }],
    confidence: 0.8,
    citations: [{ sourceId: 1, text: "Documented fixture." }],
    evidenceRisks: ["Single-source coverage."],
    status: "grounded",
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
}

function agentWithCapture(maxOutputTokens, captured) {
  const plan = {
    reportId: "00000000-0000-4000-8000-000000000000",
    taskId: "research-research",
    stage: "research",
    taskDescription: "Probe research.",
    summary: "Probe plan.",
    sources: [],
    confidence: 0.1,
    citations: [],
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
  return createResearchAgent({
    config: { maxOutputTokens },
    execute: async (_ctx, request) => {
      captured.push(request);
      const leg = request?.callIdentity?.callLeg;
      const output = leg === "FINAL_SYNTHESIS" ? synthesisOutput() : plan;
      return { output, raw: "{}", usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.00001 }, model: "test", provider: "test", latencyMs: 1 };
    },
    capabilityExecution: {
      async executeCapability(request) {
        return {
          status: "success",
          resultId: `result-${request.requestId}`,
          capabilityId: request.capabilityId,
          output: { results: EVIDENCE, providerId: "probe" },
          evidence: { providerId: "probe", evidenceId: "ev-probe", succeeded: true, executedAt: "2026-09-25T00:00:00.000Z" },
        };
      },
    },
  });
}

function baseInput() {
  return {
    task,
    contract,
    synthesisContract: "amf-research-synthesis-v1",
    capabilityRequests: [{ requestId: "cap-1", capabilityId: "web.search", agentId: "research", workflowId: "wf-1", correlationId: "corr-1", input: { query: "probe", maxResults: 5 }, requestedAt: "2026-09-25T00:00:00.000Z" }],
  };
}

describe("synthesis output-budget floor", () => {
  it("floor constant is 8192", () => {
    strictEqual(FINAL_SYNTHESIS_MIN_OUTPUT_TOKENS, 8192);
  });

  it("FINAL_SYNTHESIS carries at least the floor even when configured 4096, DIRECTION keeps 4096", async () => {
    const captured = [];
    const agent = agentWithCapture(4096, captured);
    await agent.execute({ context: {}, input: baseInput() }, signal);
    const synthesis = captured.filter((r) => r?.callIdentity?.callLeg === "FINAL_SYNTHESIS");
    const direction = captured.filter((r) => r?.callIdentity?.callLeg === "DIRECTION");
    strictEqual(synthesis.length, 1);
    strictEqual(synthesis[0].maxOutputTokens, 8192);
    strictEqual(direction.length, 1);
    strictEqual(direction[0].maxOutputTokens, 4096);
  });

  it("floor never lowers an explicitly larger configuration", async () => {
    const captured = [];
    const agent = agentWithCapture(16384, captured);
    await agent.execute({ context: {}, input: baseInput() }, signal);
    const synthesis = captured.filter((r) => r?.callIdentity?.callLeg === "FINAL_SYNTHESIS");
    strictEqual(synthesis.length, 1);
    strictEqual(synthesis[0].maxOutputTokens, 16384);
  });
});
