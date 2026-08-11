import { strictEqual, deepStrictEqual, ok, throws } from "node:assert";
import { describe, it } from "node:test";
import { Orchestrator } from "@ai-media-factory/orchestrator";
import {
  CEOAgent,
  createCEOAgent,
  executiveContext,
  planExecutive,
  produceExecutive,
  toOrchestratorDirective,
} from "../dist/index.js";

const FIXED_CLOCK = () => "2026-08-12T00:00:00.000Z";
const ALL = new Set(["planner", "research", "coding", "reviewer", "qa", "documentation"]);
const INTENTS = ["plan", "research", "implement", "verify", "ship"];

const AGENT_KIND = { planner: "execution_plan", research: "research_report", coding: "coding_report", reviewer: "review_report", qa: "qa_report", documentation: "documentation_report" };

function makeFake(registrySet) {
  const calls = [];
  let previous;
  const executor = {
    executeAgentStep: async (step, ctx) => {
      if (!registrySet.has(step.agent)) return { status: "failed", output: {}, error: { message: `unresolved agent: ${step.agent}`, retryable: false } };
      calls.push(step.agent);
      const kind = AGENT_KIND[step.agent];
      const artifact = {
        artifactId: `${step.agent}-1`,
        kind,
        producerAgent: step.agent,
        workflowId: ctx.workflowId,
        correlationId: ctx.correlationId,
        status: "completed",
        payload: {},
        contentType: "application/json",
        schemaVersion: "1.0",
        createdAt: "2026-08-11T00:00:00.000Z",
        ...(previous ? { parentArtifact: { artifactId: previous.artifactId, kind: previous.kind } } : {}),
      };
      previous = artifact;
      return { status: "completed", output: {}, artifact };
    },
  };
  return { executor, calls };
}

const TARGET = { workflowId: "workflow-ceo", correlationId: "corr-ceo", brandId: null, data: {} };

describe("CEOAgent — deterministic directive production", () => {
  it("produces a valid deterministic directive with the minimum fields", () => {
    const ceo = createCEOAgent({ registry: { has: (id) => ALL.has(id) }, clock: FIXED_CLOCK });
    const directive = ceo.decide({ objective: "Validate the release", intent: "verify", priority: "high", constraints: { deterministic: true } });
    strictEqual(directive.directiveId.length > 0, true);
    strictEqual(directive.objective, "Validate the release");
    strictEqual(directive.workflowIntent, "verify");
    strictEqual(directive.priority, "high");
    deepStrictEqual(directive.requestedStages, ["planner", "research", "coding", "reviewer", "qa"]);
    strictEqual(directive.createdAt, "2026-08-12T00:00:00.000Z");
    strictEqual(directive.decisionEvidence.kind, "executive_decision");
    strictEqual(directive.decisionEvidence.selectedWorkflow, "verify");
    deepStrictEqual(directive.decisionEvidence.selectedAgents, directive.requestedStages);
    strictEqual(directive.decisionEvidence.directiveId, directive.directiveId);
  });

  it("is deterministic: identical input yields an identical directive", () => {
    const ceo = createCEOAgent({ registry: { has: (id) => ALL.has(id) }, clock: FIXED_CLOCK });
    const request = { objective: "Ship the media pipeline", intent: "ship", priority: "urgent", constraints: { maxStages: 6 } };
    const a = ceo.decide(request);
    const b = ceo.decide(request);
    deepStrictEqual(a, b);
  });

  it("supports all existing workflow intents and maps to their templates", () => {
    const ceo = createCEOAgent({ registry: { has: (id) => ALL.has(id) }, clock: FIXED_CLOCK });
    for (const intent of INTENTS) {
      const directive = ceo.decide({ objective: `Run ${intent}`, intent });
      strictEqual(directive.workflowIntent, intent);
      strictEqual(toOrchestratorDirective(directive), intent);
      ok(directive.requestedStages.length >= 1);
      for (const agent of directive.requestedStages) strictEqual(ALL.has(agent), true);
    }
  });

  it("defaults priority to medium when not supplied", () => {
    const ceo = createCEOAgent({ registry: { has: (id) => ALL.has(id) }, clock: FIXED_CLOCK });
    strictEqual(ceo.decide({ objective: "x", intent: "plan" }).priority, "medium");
  });

  it("rejects empty and invalid objectives", () => {
    const ceo = createCEOAgent({ registry: { has: (id) => ALL.has(id) } });
    throws(() => ceo.decide({ objective: "", intent: "plan" }), /objective/i);
    throws(() => ceo.decide({ objective: "   ", intent: "plan" }), /objective/i);
    throws(() => ceo.decide({ intent: "plan" }), /objective/i);
    throws(() => ceo.decide(undefined), /request/i);
  });

  it("rejects unknown, empty, and complex workflow intents", () => {
    const ceo = createCEOAgent({ registry: { has: (id) => ALL.has(id) } });
    throws(() => ceo.decide({ objective: "x", intent: "magic" }), /intent/i);
    throws(() => ceo.decide({ objective: "x", intent: "" }), /intent/i);
    throws(() => ceo.decide({ objective: "x", intent: { plan: true } }), /intent/i);
  });

  it("rejects unavailable agents and never invents agents", () => {
    const partial = new Set(["planner", "research"]);
    const ceo = createCEOAgent({ registry: { has: (id) => partial.has(id) }, clock: FIXED_CLOCK });
    throws(() => ceo.decide({ objective: "x", intent: "ship" }), /Unavailable agent: coding/);
    throws(() => ceo.decide({ objective: "x", intent: "verify" }), /Unavailable agent: coding/);
  });

  it("rejects malformed constraints", () => {
    const ceo = createCEOAgent({ registry: { has: (id) => ALL.has(id) } });
    throws(() => ceo.decide({ objective: "x", intent: "plan", constraints: null }), /Constraints must be a plain object/);
    throws(() => ceo.decide({ objective: "x", intent: "plan", constraints: "fast" }), /Constraints must be a plain object/);
    throws(() => ceo.decide({ objective: "x", intent: "plan", constraints: { bogus: 1 } }), /Unsupported constraint: bogus/);
    throws(() => ceo.decide({ objective: "x", intent: "plan", constraints: { maxStages: 0 } }), /maxStages/);
    throws(() => ceo.decide({ objective: "x", intent: "plan", constraints: { requiredCapabilities: "text-generation" } }), /requiredCapabilities/);
    throws(() => ceo.decide({ objective: "x", intent: "plan", constraints: { deterministic: "yes" } }), /deterministic/);
  });

  it("rejects invalid priority", () => {
    const ceo = createCEOAgent({ registry: { has: (id) => ALL.has(id) } });
    throws(() => ceo.decide({ objective: "x", intent: "plan", priority: "critical" }), /priority/i);
    throws(() => ceo.decide({ objective: "x", intent: "plan", priority: 3 }), /priority/i);
  });

  it("never exposes capability execution or producer surfaces (decision layer only)", () => {
    const ceo = createCEOAgent({ registry: { has: (id) => ALL.has(id) } });
    strictEqual(typeof ceo.decide, "function");
    strictEqual(ceo.executeCapability, undefined);
    strictEqual(ceo.produce, undefined);
    strictEqual(ceo.execute, undefined);
    strictEqual(ceo.executeAgentStep, undefined);
  });
});

describe("CEOAgent — decision evidence integrity", () => {
  it("produces decision evidence distinct from capability execution evidence", () => {
    const ceo = createCEOAgent({ registry: { has: (id) => ALL.has(id) }, clock: FIXED_CLOCK, decisionSource: "test-executive-policy" });
    const directive = ceo.decide({ objective: "Improve the pipeline", intent: "research" });
    const evidence = directive.decisionEvidence;
    strictEqual(evidence.kind, "executive_decision");
    strictEqual(evidence.decisionSource, "test-executive-policy");
    strictEqual(evidence.objective, "Improve the pipeline");
    strictEqual(evidence.selectedWorkflow, "research");
    deepStrictEqual(evidence.selectedAgents, ["planner", "research"]);
    strictEqual(evidence.decidedAt, directive.createdAt);
    strictEqual(evidence.evidenceId !== evidence.directiveId, true);
    // Not a capability result: no execution status, no CapabilityResult fields.
    strictEqual(evidence.status, undefined);
    strictEqual(evidence.succeeded, undefined);
  });
});

describe("CEOAgent — Orchestrator integration (CEO → ExecutiveDirective → Orchestrator)", () => {
  it("forwards a directive to the existing Orchestrator.plan() contract without duplicating logic", () => {
    const ceo = createCEOAgent({ registry: { has: (id) => ALL.has(id) }, clock: FIXED_CLOCK });
    const directive = ceo.decide({ objective: "Research the pipeline", intent: "research" });
    const orchestrator = new Orchestrator();
    const context = executiveContext(directive, TARGET);
    const plan = planExecutive(orchestrator, directive, context);
    strictEqual(plan.directive, "research");
    deepStrictEqual(plan.agents, directive.requestedStages);
    strictEqual(plan.stages.length, 2);
    strictEqual(context.workflowId, "workflow-ceo");
    strictEqual(context.correlationId, "corr-ceo");
    strictEqual(context.data.objective, "Research the pipeline");
  });

  it("executes through the existing Orchestrator produce path (single execution path)", async () => {
    const ceo = createCEOAgent({ registry: { has: (id) => ALL.has(id) }, clock: FIXED_CLOCK });
    const directive = ceo.decide({ objective: "Research the pipeline", intent: "research" });
    const { executor, calls } = makeFake(ALL);
    const orchestrator = new Orchestrator({ executor });
    const context = executiveContext(directive, TARGET);
    const result = await produceExecutive(orchestrator, directive, context);
    strictEqual(result.status, "completed");
    deepStrictEqual(calls, ["planner", "research"]);
    deepStrictEqual(result.lineage.map((item) => item.workflowId), ["workflow-ceo", "workflow-ceo"]);
    deepStrictEqual(result.lineage.map((item) => item.correlationId), ["corr-ceo", "corr-ceo"]);
    strictEqual(result.lineage[1].parentArtifact.artifactId, "planner-1");
  });

  it("propagates execution failures through the produce path", async () => {
    const ceo = createCEOAgent({ registry: { has: (id) => ALL.has(id) }, clock: FIXED_CLOCK });
    const directive = ceo.decide({ objective: "Research the pipeline", intent: "research" });
    const { executor } = makeFake(new Set(["planner"]));
    const orchestrator = new Orchestrator({ executor });
    const result = await produceExecutive(orchestrator, directive, executiveContext(directive, TARGET));
    strictEqual(result.status, "failed");
  });

  it("never forwards an invalid directive to the Orchestrator", () => {
    const ceo = createCEOAgent({ registry: { has: (id) => ALL.has(id) } });
    let reached = false;
    const orchestrator = new Orchestrator({ executor: { executeAgentStep: async () => { reached = true; return { status: "completed", output: {} }; } } });
    throws(() => planExecutive(orchestrator, { directiveId: "x", objective: "x", workflowIntent: "magic", priority: "medium", requestedStages: [], constraints: {}, createdAt: "t", decisionEvidence: {} }, TARGET), /Unsupported directive/);
    strictEqual(reached, false);
  });

  it("does not create an alternate execution path (uses Orchestrator.produce)", async () => {
    const ceo = createCEOAgent({ registry: { has: (id) => ALL.has(id) }, clock: FIXED_CLOCK });
    const directive = ceo.decide({ objective: "Plan", intent: "plan" });
    const { executor, calls } = makeFake(ALL);
    const orchestrator = new Orchestrator({ executor });
    const result = await produceExecutive(orchestrator, directive, executiveContext(directive, TARGET));
    strictEqual(result.status, "completed");
    deepStrictEqual(calls, ["planner"]);
  });
});