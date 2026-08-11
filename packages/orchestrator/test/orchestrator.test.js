import { strictEqual, deepStrictEqual, ok, throws, rejects } from "node:assert";
import { describe, it } from "node:test";
import { Orchestrator } from "../dist/index.js";

const SHIP_AGENTS = ["planner", "research", "coding", "reviewer", "qa", "documentation"];
const SHIP_OUTPUTS = ["execution_plan", "research_report", "coding_report", "review_report", "qa_report", "documentation_report"];

describe("Orchestrator — deterministic planning", () => {
  it("stub() returns a cohesive, non-executing scaffold for the known directive", () => {
    const plan = new Orchestrator().stub("ship");
    strictEqual(plan.directive, "ship");
    strictEqual(plan.workflowId, null);
    deepStrictEqual(plan.agents, SHIP_AGENTS);
    deepStrictEqual(plan.outputs.map((output) => output.artifactKind), SHIP_OUTPUTS);
    strictEqual(plan.stages.length, 6);
    for (let i = 0; i < plan.stages.length; i += 1) {
      strictEqual(plan.stages[i].step.kind, "agent");
      strictEqual(plan.stages[i].step.agent, SHIP_AGENTS[i]);
      strictEqual(plan.stages[i].artifactKind, SHIP_OUTPUTS[i]);
    }
  });

  it("stub() compiles every directive deterministically and round-trips identical plans", () => {
    const orchestrator = new Orchestrator();
    for (const directive of ["plan", "research", "implement", "verify", "ship"]) {
      const a = orchestrator.stub(directive);
      const b = orchestrator.stub(directive);
      deepStrictEqual(a, b);
      strictEqual(a.agents.length, a.stages.length);
    }
  });

  it("produces distinct but stable plans per directive (no hidden state/drift)", () => {
    const orchestrator = new Orchestrator();
    deepStrictEqual(new Orchestrator().stub("research").outputs.map((o) => o.artifactKind), ["execution_plan", "research_report"]);
    deepStrictEqual(new Orchestrator().stub("verify").outputs.map((o) => o.artifactKind), ["execution_plan", "research_report", "coding_report", "review_report", "qa_report"]);
    const bounded = orchestrator.stub("plan");
    strictEqual(bounded.agents.length, 1);
    strictEqual(bounded.stages[0].step.agent, "planner");
  });

  it("plan() binds the deterministic template to the caller's workflow identity", () => {
    const context = { workflowId: "workflow-orch", correlationId: "corr-orch", brandId: null, outputs: {}, data: { objective: "release" } };
    const plan = new Orchestrator().plan("ship", context);
    strictEqual(plan.workflowId, "workflow-orch");
    strictEqual(plan.correlationId, "corr-orch");
    deepStrictEqual(plan.agents, SHIP_AGENTS);
  });

  it("rejects empty, unknown, and complex directive values — never guesses", () => {
    const orchestrator = new Orchestrator();
    throws(() => orchestrator.stub("magic"), /Unsupported directive/);
    throws(() => orchestrator.stub(undefined), /Unsupported directive/);
    throws(() => orchestrator.stub(""), /Unsupported directive/);
    throws(() => orchestrator.stub({ capability: "ship" }), /Unsupported directive/);
    throws(() => orchestrator.stub(["ship"]), /Unsupported directive/);
  });

  it("rejects unsupported, non-object, and null option values", () => {
    const orchestrator = new Orchestrator();
    throws(() => orchestrator.stub("ship", { bogus: 1 }), /Unsupported option: bogus/);
    throws(() => orchestrator.stub("ship", { produce: true }), /Unsupported option: produce/);
    throws(() => orchestrator.stub("ship", null), /plain object/);
    throws(() => orchestrator.stub("ship", "fast"), /plain object/);
  });

  it("rejects malformed supported-option values", () => {
    const orchestrator = new Orchestrator();
    throws(() => orchestrator.stub("ship", { timeoutSeconds: 0 }), /timeoutSeconds must be a positive integer/);
    throws(() => orchestrator.stub("ship", { timeoutSeconds: 1.5 }), /timeoutSeconds must be a positive integer/);
    throws(() => orchestrator.stub("ship", { maxAttempts: -1 }), /maxAttempts must be a positive integer/);
    throws(() => orchestrator.stub("ship", { maxAttempts: "three" }), /maxAttempts must be a positive integer/);
  });

  it("applies only recognized options to the compiled steps", () => {
    const plain = new Orchestrator().stub("implement");
    const tuned = new Orchestrator().stub("implement", { timeoutSeconds: 30, maxAttempts: 3 });
    strictEqual(plain.stages[2].step.timeoutSeconds, undefined);
    strictEqual(tuned.stages[2].step.timeoutSeconds, 30);
    strictEqual(tuned.stages[2].step.maxAttempts, 3);
    deepStrictEqual(tuned.agents, ["planner", "research", "coding", "reviewer"]);
  });

  it("rejects plan()/produce() with empty or missing contexts", async () => {
    const executor = { executeAgentStep: async () => ({ status: "completed", output: {} }) };
    const orchestrator = new Orchestrator();
    const producing = new Orchestrator({ executor });
    throws(() => orchestrator.plan("plan", undefined), /context is required/);
    throws(() => orchestrator.plan("plan", { workflowId: "  ", correlationId: null, brandId: null, outputs: {}, data: {} }), /workflowId/);
    await rejects(async () => producing.produce("plan", undefined), /context is required/);
    await rejects(async () => producing.produce("plan", { workflowId: "", correlationId: null, brandId: null, outputs: {}, data: {} }), /workflowId/);
  });
});

describe("Orchestrator — registry boundary", () => {
  it("validates agent existence via .has() when a registry is supplied", () => {
    const registered = new Set(["planner", "research"]);
    const orchestrator = new Orchestrator({ registry: { has: (id) => registered.has(id) } });
    ok(orchestrator.stub("research").agents.length === 2);
    throws(() => orchestrator.stub("ship"), /Agent not registered: coding/);
  });

  it("does not require a registry to plan or stub (registry is optional validation)", () => {
    const plan = new Orchestrator().stub("buy_something_unsupported_capability" === "no" ? "plan" : "ship");
    strictEqual(plan.agents.length, 6);
  });
});

describe("Orchestrator — produce() execution boundary", () => {
  it("requires an AgentExecutorPort before it can produce", async () => {
    const orchestrator = new Orchestrator();
    const context = { workflowId: "workflow-orch", correlationId: "corr-orch", brandId: null, outputs: {}, data: {} };
    await rejects(async () => orchestrator.produce("plan", context), /requires an AgentExecutorPort/);
  });
});