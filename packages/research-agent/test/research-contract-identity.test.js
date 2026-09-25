/** Provider-free Research contract-identity fixtures (task V1 remediation). No network. */
import { describe, it } from "node:test";
import { strictEqual, ok, rejects } from "node:assert";
import {
  createResearchAgent,
  diagnoseResearchStructure,
  ResearchAuthorityViolationError,
  ResearchStructuralValidationError,
} from "../dist/index.js";

const task = {
  id: "research-research",
  name: "Research",
  description: "Production research for Select the strongest evidence-grounded factual micro-story for Morroway Pilot 1: Use Morroway strategy, brand context, governed retrieval, and executive reasoning to choose and develop one genuinely publishable first factual YouTube Short.",
  agent: "research",
  inputSchema: {},
  outputSchema: {},
  dependencies: [],
};

const contract = { taskId: "research-research", stage: "research" };

const paraphrase = "Select and develop one evidence-grounded, publishable factual YouTube Short for Morroway Pilot 1, using Morroway strategy, brand context, and governed retrieval.";

function validOutput(overrides = {}) {
  return {
    reportId: "00000000-0000-4000-8000-000000000000",
    taskId: "research-research",
    stage: "research",
    taskDescription: paraphrase,
    summary: "Candidate factual stories with documented provenance.",
    sources: [{ id: 1, title: "Qanat tunnels", url: "https://example.test/qanat", snippet: "Documented water tunnels." }],
    confidence: 0.8,
    citations: [{ sourceId: 1, text: "Documented water tunnels." }],
    metadata: { createdAt: "2026-09-25T00:00:00.000Z", agentVersion: "research" },
    ...overrides,
  };
}

function agentFor(output, deps = {}) {
  return createResearchAgent({
    config: {},
    execute: async () => ({ output, raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "test", provider: "test", latencyMs: 1 }),
    ...deps,
  });
}

const signal = { isCancelled: false, onCancelled() {}, throwIfCancelled() {} };

const fakeResults = [
  { title: "Qanat tunnels", url: "https://example.test/qanat", snippet: "Documented water tunnels.", source: "example", rank: 1 },
];
const fakeBoundary = {
  async executeCapability(request) {
    return {
      status: "success",
      capabilityId: request.capabilityId,
      requestId: request.requestId,
      output: { results: fakeResults, providerId: "serper" },
      evidence: { providerId: "serper", evidenceId: "evidence-1", succeeded: true, executedAt: "2026-09-25T00:00:00.000Z", capabilityId: request.capabilityId, agentId: "research", workflowId: "wf-1", correlationId: "corr-1", resultCount: 1, resultStatus: "success" },
      resultId: "result-1",
    };
  },
};

describe("research contract identity", () => {
  it("A: valid taskId plus paraphrased description passes structurally", async () => {
    const agent = agentFor(validOutput());
    const result = await agent.execute({ context: {}, input: { task, contract } }, signal);
    strictEqual(result.output.taskId, "research-research");
    strictEqual(result.output.taskDescription, paraphrase);
  });

  it("B: wrong taskId fails deterministically", async () => {
    const agent = agentFor(validOutput({ taskId: "planner-synthesis" }));
    await rejects(agent.execute({ context: {}, input: { task, contract } }, signal), (error) => {
      ok(error instanceof ResearchStructuralValidationError);
      ok(error.diagnostics.issues.some((issue) => issue.path === "taskId"));
      return true;
    });
  });

  it("C: wrong stage fails deterministically", async () => {
    const agent = agentFor(validOutput({ stage: "planner" }));
    await rejects(agent.execute({ context: {}, input: { task, contract } }, signal), (error) => {
      ok(error instanceof ResearchStructuralValidationError);
      ok(error.diagnostics.issues.some((issue) => issue.path === "stage"));
      return true;
    });
  });

  it("D: unauthorized media/publication action hard-fails", async () => {
    const agent = agentFor(validOutput({ summary: "Approve publication and upload the video now." }));
    await rejects(agent.execute({ context: {}, input: { task, contract } }, signal), (error) => {
      ok(error instanceof ResearchAuthorityViolationError);
      strictEqual(error.hardFailReason, "OWNER_AUTHORITY_BOUNDARY");
      return true;
    });
  });

  it("E: valid capability plan proceeds to web.search execution", async () => {
    const plan = validOutput({ sources: [], citations: [], confidence: 0.1, summary: "Plan: retrieve candidate factual stories via web.search." });
    const agent = agentFor(plan, { capabilityExecution: fakeBoundary });
    const result = await agent.execute({
      context: {},
      input: {
        task,
        contract,
        capabilityRequests: [{ requestId: "cap-1", capabilityId: "web.search", agentId: "research", workflowId: "wf-1", correlationId: "corr-1", input: { query: "factual candidates", maxResults: 5 }, requestedAt: "2026-09-25T00:00:00.000Z" }],
      },
    }, signal);
    strictEqual(result.output.capabilityExecutions.length, 1);
    strictEqual(result.output.capabilityExecutions[0].status, "success");
  });

  it("F: retrieval results are preserved exactly for synthesis", async () => {
    const agent = agentFor(validOutput(), { capabilityExecution: fakeBoundary });
    const result = await agent.execute({
      context: {},
      input: {
        task,
        contract,
        capabilityRequests: [{ requestId: "cap-1", capabilityId: "web.search", agentId: "research", workflowId: "wf-1", correlationId: "corr-1", input: { query: "factual candidates", maxResults: 5 }, requestedAt: "2026-09-25T00:00:00.000Z" }],
      },
    }, signal);
    strictEqual(JSON.stringify(result.output.capabilityExecutions[0].output.results), JSON.stringify(fakeResults));
  });

  it("legacy path without contract still requires the exact description", async () => {
    const agent = agentFor({ ...validOutput(), taskId: undefined, stage: undefined, taskDescription: "something else entirely" });
    await rejects(agent.execute({ context: {}, input: { task } }, signal), /invalid report structure/);
    const diagnostics = diagnoseResearchStructure({ ...validOutput(), taskId: undefined, stage: undefined, taskDescription: "something else entirely" }, { task });
    ok(diagnostics.issues.some((issue) => issue.path === "taskDescription"));
  });
});
