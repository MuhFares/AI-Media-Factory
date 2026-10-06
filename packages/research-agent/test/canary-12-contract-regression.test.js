import test from "node:test";
import assert from "node:assert/strict";
import { createResearchAgent } from "../dist/index.js";
import { CANARY12_SYNTHESIS } from "./fixtures/canary-12-evidence-gate.js";

const task = { id: "research-research", name: "Research", description: CANARY12_SYNTHESIS.taskDescription, agent: "research", inputSchema: {}, outputSchema: {}, dependencies: [] };
const signal = { isCancelled: false, onCancelled() {}, throwIfCancelled() {} };

test("Canary-12 historical candidates missing mandatory eligibility fields fail structurally", async () => {
  const plan = { reportId: "00000000-0000-4000-8000-000000000000", taskId: task.id, stage: "research", taskDescription: task.description, summary: "plan", sources: [], confidence: 0, citations: [], metadata: { createdAt: "2026-10-05T00:00:00.000Z", agentVersion: "test" } };
  const agent = createResearchAgent({
    config: {},
    execute: async (_context, request) => ({
      output: request.callIdentity?.callLeg === "FINAL_SYNTHESIS" ? structuredClone(CANARY12_SYNTHESIS) : plan,
      raw: "{}", usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, model: "fixture", provider: "fixture", latencyMs: 1,
    }),
    capabilityExecution: { async executeCapability(request) { return { status: "success", resultId: `result-${request.requestId}`, capabilityId: request.capabilityId, output: { results: [{ title: "fixture", url: "https://example.test/x", snippet: "fixture" }], providerId: "fixture" }, evidence: { providerId: "fixture", evidenceId: "evidence-fixture", succeeded: true, executedAt: "2026-10-05T00:00:00.000Z" } }; } },
  });
  await assert.rejects(
    agent.execute({ context: {}, input: {
      task, contract: { taskId: task.id, stage: "research" }, synthesisContract: "amf-research-synthesis-v1",
      researchObjective: { objectiveId: "objective-1", factualMode: "HISTORICAL_POV" },
      capabilityRequests: [{ requestId: "cap-1", capabilityId: "web.search", agentId: "research", workflowId: "wf-fixture", correlationId: "corr-fixture", input: { query: "fixture", maxResults: 5 }, requestedAt: "2026-10-05T00:00:00.000Z" }],
    } }, signal),
    (error) => error?.diagnostics?.issues?.some((issue) => issue.path === "candidateStories[0].evidenceRisks" && issue.code === "missing_required"),
  );
});
