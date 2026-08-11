import { strictEqual, deepStrictEqual, ok, throws, rejects } from "node:assert";
import { describe, it } from "node:test";
import { Orchestrator } from "../dist/index.js";

const context = { workflowId: "workflow-orch", correlationId: "corr-orch", brandId: null, outputs: {}, data: { objective: "release" } };

function artifact(kind, agent, artifactId, payload, parent) {
  return {
    artifactId,
    kind,
    producerAgent: agent,
    workflowId: context.workflowId,
    correlationId: context.correlationId,
    status: "completed",
    payload,
    contentType: "application/json",
    schemaVersion: "1.0",
    createdAt: "2026-08-10T00:00:00.000Z",
    ...(parent ? { parentArtifact: { artifactId: parent.artifactId, kind: parent.kind } } : {}),
  };
}

const AGENT_ARTIFACT_KIND = {
  planner: "execution_plan",
  research: "research_report",
  coding: "coding_report",
  reviewer: "review_report",
  qa: "qa_report",
  documentation: "documentation_report",
};

function payloadFor(kind) {
  switch (kind) {
    case "execution_plan": return { planId: "plan-1", objective: "release", tasks: [] };
    case "research_report": return { reportId: "research-1", taskDescription: "plan", summary: "researched", sources: [] };
    case "coding_report": return { resultId: "coding-1", taskDescription: "code", status: "completed", summary: "built", actions: [] };
    case "review_report": return { reportId: "review-1", taskDescription: "code", status: "approved", summary: "pass", findings: [] };
    case "qa_report": return { reportId: "qa-1", objective: "release", status: "passed", summary: "ok", testResults: [{ testName: "smoke", status: "passed", executed: true, source: "runtime", evidence: "runner pass" }], executionEvidencePresent: true };
    case "documentation_report": return { resultId: "doc-1", objective: "release", status: "generated", summary: "validated", sections: [], generatedOnly: true, persistence: "not_written" };
    default: throw new Error(`no payload for ${kind}`);
  }
}

/** Base AgentExecutorPort that resolves an agent and produces a lineage-chained artifact. */
function buildExecutor(registrySet) {
  const calls = [];
  let previous;
  const executor = {
    executeAgentStep: async (step) => {
      if (!registrySet.has(step.agent)) return { status: "failed", output: {}, error: { message: `unresolved agent: ${step.agent}`, retryable: false } };
      calls.push(step.agent);
      const kind = AGENT_ARTIFACT_KIND[step.agent];
      const produced = artifact(kind, step.agent, `${step.agent}-1`, payloadFor(kind), previous);
      previous = produced;
      return { status: "completed", output: {}, artifact: produced };
    },
  };
  return { executor, calls };
}

const FULL = new Set(["planner", "research", "coding", "reviewer", "qa", "documentation"]);

describe("Orchestrator.produce() — registry-backed execution", () => {
  it("executes the compiled plan through the AgentExecutorPort in directive order", async () => {
    const { executor, calls } = buildExecutor(FULL);
    const orchestrator = new Orchestrator({ registry: { has: (id) => FULL.has(id) }, executor });
    const result = await orchestrator.produce("ship", context);
    strictEqual(result.status, "completed");
    deepStrictEqual(calls, ["planner", "research", "coding", "reviewer", "qa", "documentation"]);
  });

  it("produces a provenance-valid lineage (identity carried through every step)", async () => {
    const { executor } = buildExecutor(FULL);
    const orchestrator = new Orchestrator({ registry: { has: (id) => FULL.has(id) }, executor });
    const result = await orchestrator.produce("ship", context);
    strictEqual(result.output.kind, "documentation_report");
    deepStrictEqual(result.lineage.map((item) => item.producerAgent), ["planner", "research", "coding", "reviewer", "qa", "documentation"]);
    for (const item of result.lineage) {
      strictEqual(item.workflowId, context.workflowId);
      strictEqual(item.correlationId, context.correlationId);
    }
  });

  it("produces lineage continuity when the executor links each artifact to its predecessor", async () => {
    const { executor } = buildExecutor(FULL);
    const orchestrator = new Orchestrator({ registry: { has: (id) => FULL.has(id) }, executor });
    const result = await orchestrator.produce("ship", context);
    strictEqual(result.lineage.length, 6);
    for (let i = 1; i < result.lineage.length; i += 1) {
      strictEqual(result.lineage[i].parentArtifact.artifactId, `${result.lineage[i - 1].producerAgent}-1`);
    }
  });

  it("validates every agent is registered before executing (registry.has gating)", async () => {
    const registrySet = new Set(["planner", "research"]);
    const { executor } = buildExecutor(new Set(["planner", "research"]));
    const orchestrator = new Orchestrator({ registry: { has: (id) => registrySet.has(id) }, executor });
    await rejects(async () => orchestrator.produce("ship", context), /Agent not registered: coding/);
  });

  it("fails the run when the resolver cannot resolve a compiled agent", async () => {
    const { executor, calls } = buildExecutor(new Set(["planner", "research"]));
    const orchestrator = new Orchestrator({ executor });
    const result = await orchestrator.produce("implement", context);
    strictEqual(result.status, "failed");
    deepStrictEqual(calls, ["planner", "research"]);
    strictEqual(result.error.message.includes("unresolved agent"), true);
  });

  it("rejects identity violations returned by an executor", async () => {
    const { executor } = buildExecutor(FULL);
    const evil = {
      executeAgentStep: async (step) => {
        if (step.agent === "planner") return { status: "completed", output: {}, artifact: artifact("execution_plan", "evil_producer", "plan-1", payloadFor("execution_plan"), undefined) };
        return executor.executeAgentStep(step);
      },
    };
    const orchestrator = new Orchestrator({ executor: evil });
    const result = await orchestrator.produce("research", context);
    strictEqual(result.status, "failed");
    strictEqual(result.error.message.includes("identity"), true);
  });

  it("reuses the existing Workflow Engine runner rather than reimplementing execution", async () => {
    const { executor } = buildExecutor(FULL);
    const orchestrator = new Orchestrator({ executor });
    const result = await orchestrator.produce("research", context);
    strictEqual(result.status, "completed");
    strictEqual(result.lineage.length, 2);
  });

  it("implements the boundary as a concrete class delegating to the executor port", async () => {
    const source = await import("node:fs/promises");
    const text = await source.readFile(new URL("../dist/orchestrator.js", import.meta.url), "utf8");
    ok(/class Orchestrator/.test(text));
    ok(/CollaborationRunner/.test(text));
  });
});