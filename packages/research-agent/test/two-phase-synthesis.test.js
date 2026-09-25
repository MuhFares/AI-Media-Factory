/** Provider-free two-phase research synthesis (plan → retrieval → synthesis). No network. */
import { describe, it } from "node:test";
import { strictEqual, ok, rejects } from "node:assert";
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
const SYNTHESIS_CONTRACT = "amf-research-synthesis-v1";

const EVIDENCE = [
  { title: "Qanat tunnels", url: "https://example.test/qanat", snippet: "Documented water tunnels.", source: "example.test", rank: 1 },
];

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

function synthesisOutput() {
  return {
    reportId: "11111111-1111-4111-8111-111111111111",
    taskId: "research-research",
    stage: "research",
    taskDescription: "Probe synthesis of Morroway factual candidates from retrieved evidence.",
    summary: "One dated candidate with field-survey provenance.",
    candidateStories: [{
      candidateId: "candidate-1", topic: "Qanat water tunnels", factualAngle: "Ancient Persian engineering",
      keyClaims: ["Qanat tunnels convey groundwater"], sourceIds: [1], supportingEvidenceIds: [1],
      sourceQualitySummary: "Field survey", visualPotential: "Tunnel footage", shortFormPotential: "30-second reveal",
      evidenceRisks: [], verificationStatus: "needs-verification",
    }],
    sources: [{ id: 1, title: "Qanat tunnels", url: "https://example.test/qanat", snippet: "Documented water tunnels." }],
    confidence: 0.8,
    citations: [{ sourceId: 1, text: "Documented water tunnels." }],
    evidenceRisks: ["Single-source coverage."],
    status: "grounded",
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
  };
}

const signal = { isCancelled: false, onCancelled() {}, throwIfCancelled() {} };
const capabilityRequests = [{ requestId: "cap-1", capabilityId: "web.search", agentId: "research", workflowId: "wf-1", correlationId: "corr-1", input: { query: "probe", maxResults: 5 }, requestedAt: "2026-09-25T00:00:00.000Z" }];

function fakeBoundary(results = EVIDENCE) {
  return {
    async executeCapability(request) {
      return {
        status: "success",
        resultId: `result-${request.requestId}`,
        capabilityId: request.capabilityId,
        output: { results, providerId: "probe" },
        evidence: { providerId: "probe", evidenceId: "ev-probe", succeeded: true, executedAt: "2026-09-25T00:00:00.000Z" },
      };
    },
  };
}

function twoCallExecute(calls, second) {
  return async (_context, request) => {
    calls.push(JSON.stringify(request.messages.map((message) => message.content).join("\n")).slice(0, 4000));
    const isSynthesis = JSON.stringify(request).includes("Post-retrieval synthesis");
    const output = isSynthesis ? second() : planOutput();
    return { output, raw: "{}", usage: { inputTokens: 10, outputTokens: 20, costUsd: 0.00001 }, model: "test", provider: "test", latencyMs: 1 };
  };
}

function baseInput(overrides = {}) {
  return { task, contract, synthesisContract: SYNTHESIS_CONTRACT, capabilityRequests, ...overrides };
}

describe("two-phase research synthesis", () => {
  it("plan → retrieval → synthesis produces a grounded report with per-call usage", async () => {
    const calls = [];
    const agent = createResearchAgent({ config: {}, execute: twoCallExecute(calls, synthesisOutput), capabilityExecution: fakeBoundary() });
    const result = await agent.execute({ context: {}, input: baseInput() }, signal);
    strictEqual(calls.length, 2);
    strictEqual(result.output.sources.length, 1);
    strictEqual(result.output.candidateStories.length, 1);
    strictEqual(result.output.confidence, 0.8);
    strictEqual(result.output.researchStatus, undefined);
    ok(result.output.planningUsage);
    ok(result.output.synthesisUsage);
    strictEqual(result.output.synthesisUsage.costUsd, 0.00001);
    ok(result.output.researchPlan);
    strictEqual(result.output.capabilityExecutions.length, 1);
    strictEqual(result.response.usage.costUsd, 0.00002);
  });

  it("synthesis is skipped when retrieval returns no usable results", async () => {
    const calls = [];
    const emptyBoundary = { executeCapability: async (request) => ({ status: "success", resultId: "r", capabilityId: request.capabilityId, output: { results: [], providerId: "probe" }, evidence: { providerId: "probe", evidenceId: "e", succeeded: true, executedAt: "2026-09-25T00:00:00.000Z" } }) };
    const agent = createResearchAgent({ config: {}, execute: twoCallExecute(calls, synthesisOutput), capabilityExecution: emptyBoundary });
    const result = await agent.execute({ context: {}, input: baseInput() }, signal);
    strictEqual(calls.length, 1);
    strictEqual(result.output.sources.length, 0);
    strictEqual(result.output.synthesisUsage, undefined);
  });

  it("synthesis is skipped without an explicit synthesis contract", async () => {
    const calls = [];
    const agent = createResearchAgent({ config: {}, execute: twoCallExecute(calls, synthesisOutput), capabilityExecution: fakeBoundary() });
    const { synthesisContract: _omitted, ...legacyInput } = baseInput();
    const result = await agent.execute({ context: {}, input: { ...legacyInput, task } }, signal);
    strictEqual(calls.length, 1);
    strictEqual(result.output.sources.length, 0);
  });

  it("synthesis missing candidateStories fails structurally", async () => {
    const calls = [];
    const bad = { ...synthesisOutput() };
    delete bad.candidateStories;
    const agent = createResearchAgent({ config: {}, execute: twoCallExecute(calls, () => bad), capabilityExecution: fakeBoundary() });
    await rejects(agent.execute({ context: {}, input: baseInput() }, signal), /invalid report structure/);
    strictEqual(calls.length, 2);
  });

  it("synthesis candidate without candidateId fails structurally, while empty candidates pass as honest", async () => {
    const calls = [];
    const bad = { ...synthesisOutput(), candidateStories: [{ topic: "No identity" }] };
    const agent = createResearchAgent({ config: {}, execute: twoCallExecute(calls, () => bad), capabilityExecution: fakeBoundary() });
    await rejects(agent.execute({ context: {}, input: baseInput() }, signal), /invalid report structure/);
    const calls2 = [];
    const honest = { ...synthesisOutput(), candidateStories: [], confidence: 0.05, status: "insufficient_evidence" };
    const agent2 = createResearchAgent({ config: {}, execute: twoCallExecute(calls2, () => honest), capabilityExecution: fakeBoundary() });
    const result = await agent2.execute({ context: {}, input: baseInput() }, signal);
    strictEqual(calls2.length, 2);
    strictEqual(result.output.candidateStories.length, 0);
  });

  it("synthesis prompt receives bounded retrieved evidence, never invented metadata", async () => {
    const calls = [];
    const agent = createResearchAgent({ config: {}, execute: twoCallExecute(calls, synthesisOutput), capabilityExecution: fakeBoundary() });
    await agent.execute({ context: {}, input: baseInput() }, signal);
    const synthesisPrompt = calls[1];
    ok(synthesisPrompt.includes("Qanat tunnels"));
    ok(synthesisPrompt.includes("https://example.test/qanat"));
    ok(synthesisPrompt.includes("amf-research-synthesis-v1"));
  });
});
