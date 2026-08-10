import { strictEqual, deepStrictEqual, ok } from "node:assert";
import { describe, it } from "node:test";
import { CollaborationRunner } from "../dist/index.js";

const workflowId = "workflow-1";
const correlationId = "correlation-1";
const context = { workflowId, correlationId, brandId: null, outputs: {}, data: { objective: "Improve the media pipeline" } };

function artifact(kind, agent, id, payload, parentArtifact) {
  return { artifactId: id, kind, producerAgent: agent, workflowId, correlationId, status: "completed", payload, contentType: "application/json", schemaVersion: "1.0", createdAt: "2026-08-10T00:00:00.000Z", ...(parentArtifact ? { parentArtifact: { artifactId: parentArtifact.artifactId, kind: parentArtifact.kind } } : {}) };
}

function fakeExecutor(failAgent) {
  const order = [];
  const seenContexts = [];
  const executeAgentStep = async (step, currentContext) => {
    order.push(step.agent);
    seenContexts.push(currentContext);
    if (step.agent === failAgent) return { status: "failed", output: {}, error: { message: `Failed: ${step.agent}`, retryable: false } };
    const previous = currentContext.data.previousArtifact;
    const parent = previous ? { artifactId: previous.artifactId, kind: previous.kind } : undefined;
    const definitions = {
      planner: ["execution_plan", "plan-1", { planId: "plan-1", objective: currentContext.data.objective, tasks: [] }],
      research: ["research_report", "research-1", { reportId: "research-1", taskDescription: "Research plan", summary: "Research complete", sources: [] }],
      coding: ["coding_report", "coding-1", { resultId: "coding-1", taskDescription: "Implement plan", status: "blocked", summary: "Proposed coding analysis", actions: [] }],
      reviewer: ["review_report", "review-1", { reportId: "review-1", taskDescription: "Review coding", status: "approved", summary: "Review complete", findings: [] }],
    };
    const definition = definitions[step.agent];
    if (!definition) return { status: "failed", output: {}, error: { message: `Unknown agent: ${step.agent}`, retryable: false } };
    return { status: "completed", output: definition[2], artifact: artifact(definition[0], step.agent, definition[1], definition[2], parent) };
  };
  return { executor: { executeAgentStep }, order, seenContexts };
}

const stages = [
  { step: { id: "step-planner", kind: "agent", agent: "planner", emits: "plan" }, artifactKind: "execution_plan" },
  { step: { id: "step-research", kind: "agent", agent: "research", emits: "research" }, artifactKind: "research_report" },
  { step: { id: "step-coding", kind: "agent", agent: "coding", emits: "coding" }, artifactKind: "coding_report" },
  { step: { id: "step-reviewer", kind: "agent", agent: "reviewer", emits: "review" }, artifactKind: "review_report" },
];

describe("first collaboration workflow", () => {
  it("executes Planner → Research → Coding → Reviewer with stable context and lineage", async () => {
    const fake = fakeExecutor();
    const result = await new CollaborationRunner(fake.executor).run(stages, context);
    strictEqual(result.status, "completed");
    strictEqual(result.output.kind, "review_report");
    deepStrictEqual(fake.order, ["planner", "research", "coding", "reviewer"]);
    strictEqual(fake.seenContexts[0].workflowId, workflowId);
    strictEqual(fake.seenContexts[3].correlationId, correlationId);
    strictEqual(fake.seenContexts[1].data.previousArtifact.kind, "execution_plan");
    strictEqual(fake.seenContexts[2].data.previousArtifact.kind, "research_report");
    strictEqual(fake.seenContexts[3].data.previousArtifact.kind, "coding_report");
    deepStrictEqual(result.lineage.map((item) => item.artifactId), ["plan-1", "research-1", "coding-1", "review-1"]);
    strictEqual(result.lineage[3].parentArtifact.artifactId, "coding-1");
  });
  it("stops downstream execution when a stage fails", async () => {
    const fake = fakeExecutor("coding");
    const result = await new CollaborationRunner(fake.executor).run(stages, context);
    strictEqual(result.status, "failed");
    deepStrictEqual(fake.order, ["planner", "research", "coding"]);
    strictEqual(result.lineage.length, 2);
    ok(result.error.message.includes("Failed: coding"));
  });
  it("fails cleanly for an unknown AgentId", async () => {
    const fake = fakeExecutor();
    const unknownStages = [{ step: { id: "step-unknown", kind: "agent", agent: "unknown", emits: "unknown" }, artifactKind: "execution_plan" }];
    const result = await new CollaborationRunner(fake.executor).run(unknownStages, context);
    strictEqual(result.status, "failed");
    strictEqual(fake.order[0], "unknown");
    ok(result.error.message.includes("Unknown agent"));
  });
});
