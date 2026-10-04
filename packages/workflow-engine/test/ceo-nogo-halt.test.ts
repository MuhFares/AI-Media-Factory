/**
 * CEO NO-GO evidence gate — provider-free engine unit tests (no database).
 *
 * Covers arming (DefaultStepExecutor) and sticky resumption (engine.resume):
 * a completed ceo-recommendation with any non-ADVANCE verdict arms the
 * canonical bounded-execution halt; redelivery never advances past it.
 */
import { describe, it, beforeEach } from "node:test";
import { strictEqual, deepStrictEqual, ok } from "node:assert";
import {
  DefaultWorkflowEngine,
  DefaultWorkflowStateMachine,
  DefaultTimeoutController,
  DefaultWorkflowRetryPolicy,
  DefaultScheduler,
  DefaultBranchRouter,
  DefaultCheckpointCoordinator,
  DefaultRecoveryManager,
  DefaultCompensationRunner,
  DefaultApprovalCoordinator,
  DefaultStepExecutor,
  DefaultDeadLetterSink,
  DefaultAuditTrail,
  DefaultWorkflowLogger,
  DefaultWorkflowMetrics,
  DefaultWorkflowEventBridge,
} from "@ai-media-factory/workflow-engine";
import type { WorkflowDefinition } from "@ai-media-factory/workflow-engine";

function definition() {
  return {
    id: "ceo-nogo-test",
    version: 1,
    trigger: { kind: "event", spec: "Test" },
    entryStep: "ceo-recommendation",
    steps: [
      { id: "ceo-recommendation", kind: "agent", agent: "ceo", emits: "done", next: "writer" },
      { id: "writer", kind: "agent", agent: "writer", emits: "done" },
    ],
    timeoutSeconds: 300,
    compensation: { onFailure: true, onCancel: true },
  };
}

function harness(decision, onWriter) {
  const instances = new Map();
  const store = {
    loadWorkflow: async (id) => instances.get(id) ?? null,
    async saveWorkflow(instance) { instances.set(instance.workflowId, instance); },
    async listDecisions() { return []; },
    async saveDecision() { return null; },
    async saveArtifact() { return null; },
  };
  const agentExecutor = {
    async executeAgentStep(step, context) {
      if (step.id === "ceo-recommendation") {
        return {
          status: "completed",
          output: { decision },
          artifact: {
            artifactId: `art-${context.workflowId}-ceo`, kind: "ceo_recommendation", producerAgent: "ceo",
            workflowId: context.workflowId, correlationId: context.correlationId ?? "", status: "completed",
            payload: { decision, rationale: "fixture", eligibleCandidateIds: [], warnings: [] },
            contentType: "application/json", schemaVersion: "1.0", createdAt: new Date().toISOString(),
          },
        };
      }
      onWriter(step.id);
      return { status: "completed", output: {}, artifact: undefined };
    },
  };
  const checkpointCoordinator = new DefaultCheckpointCoordinator();
  const engine = new DefaultWorkflowEngine(
    new DefaultStepExecutor(agentExecutor, new DefaultBranchRouter(), new DefaultScheduler(), new DefaultTimeoutController(), new DefaultWorkflowRetryPolicy(), checkpointCoordinator, async (id) => instances.get(id) ?? null, new DefaultWorkflowStateMachine()),
    new DefaultScheduler(),
    new DefaultWorkflowStateMachine(),
    checkpointCoordinator,
    new DefaultRecoveryManager(checkpointCoordinator, store, async () => null),
    new DefaultCompensationRunner(async () => null, async () => {}),
    new DefaultApprovalCoordinator(async () => {}),
    new DefaultDeadLetterSink({ onInbound: () => {}, emit: async () => {} }),
    new DefaultAuditTrail(),
    new DefaultWorkflowLogger(),
    new DefaultWorkflowMetrics(),
    new DefaultWorkflowEventBridge(async () => {}),
    store,
    async () => definition(),
  );
  return { engine, instances };
}

async function waitFor(engine, workflowId, predicate, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const instance = await engine.describe(workflowId);
    if (instance !== null && instance !== undefined && predicate(instance)) return instance;
    if (Date.now() > deadline) throw new Error("timed out waiting for workflow condition");
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe("CEO NO-GO evidence gate", () => {
  it("E-arming: NO_PRODUCTION_CANDIDATE arms the canonical halt and writer never runs", async () => {
    const writerCalls = [];
    const { engine } = harness("NO_PRODUCTION_CANDIDATE", (id) => writerCalls.push(id));
    await engine.start({ definition: definition(), trigger: {}, workflowId: "wf-nogo", correlationId: "corr-nogo" });
    const halted = await waitFor(engine, "wf-nogo", (i) => i.state === "PAUSED" && i.context.data.boundedExecution !== undefined);
    strictEqual(halted.context.data.boundedExecution.stopAfterStepId, "ceo-recommendation");
    strictEqual(halted.context.data.boundedExecution.reason, "CEO_NO_PRODUCTION_CANDIDATE");
    strictEqual(halted.context.data.boundedExecution.authorization, "CANONICAL_EVIDENCE_GATE");
    strictEqual(halted.context.data.boundedStop.stopAfterStepId, "ceo-recommendation");
    deepStrictEqual(writerCalls, []);
    const ceo = halted.steps.find((s) => s.stepId === "ceo-recommendation");
    strictEqual(ceo.status, "completed");
    strictEqual(halted.steps.find((s) => s.stepId === "writer").status, "pending");
  });

  it("sticky: redelivery after the halt never advances past the verdict", async () => {
    const writerCalls = [];
    const { engine } = harness("HOLD", (id) => writerCalls.push(id));
    await engine.start({ definition: definition(), trigger: {}, workflowId: "wf-nogo-sticky", correlationId: "corr-nogo-sticky" });
    await waitFor(engine, "wf-nogo-sticky", (i) => i.state === "PAUSED");
    strictEqual(writerCalls.length, 0);
    await engine.resume("wf-nogo-sticky");
    await new Promise((r) => setTimeout(r, 300));
    const reloaded = await engine.describe("wf-nogo-sticky");
    strictEqual(reloaded.state, "PAUSED");
    deepStrictEqual(writerCalls, []);
    strictEqual(reloaded.context.data.boundedExecution.reason, "CEO_HOLD");
  });

  it("positive: ADVANCE never arms and the chain continues", async () => {
    const writerCalls = [];
    const { engine } = harness("ADVANCE", (id) => writerCalls.push(id));
    await engine.start({ definition: definition(), trigger: {}, workflowId: "wf-go", correlationId: "corr-go" });
    const done = await waitFor(engine, "wf-go", (i) => i.state === "COMPLETED", 8000);
    deepStrictEqual(writerCalls, ["writer"]);
    strictEqual(done.context.data.boundedExecution, undefined);
  });

  it("dry-run CEO completion without an artifact never arms", async () => {
    const writerCalls = [];
    const instances = new Map();
    const store = {
      loadWorkflow: async (id) => instances.get(id) ?? null,
      async saveWorkflow(instance) { instances.set(instance.workflowId, instance); },
      async listDecisions() { return []; },
      async saveDecision() { return null; },
      async saveArtifact() { return null; },
    };
    const dryExecutor = {
      async executeAgentStep(step, context) {
        if (step.id === "ceo-recommendation") return { status: "completed", output: { dryRun: true } };
        writerCalls.push(step.id);
        return { status: "completed", output: {}, artifact: undefined };
      },
    };
    const checkpointCoordinator = new DefaultCheckpointCoordinator();
    const dryEngine = new DefaultWorkflowEngine(
      new DefaultStepExecutor(dryExecutor, new DefaultBranchRouter(), new DefaultScheduler(), new DefaultTimeoutController(), new DefaultWorkflowRetryPolicy(), checkpointCoordinator, async (id) => instances.get(id) ?? null, new DefaultWorkflowStateMachine()),
      new DefaultScheduler(),
      new DefaultWorkflowStateMachine(),
      checkpointCoordinator,
      new DefaultRecoveryManager(checkpointCoordinator, store, async () => null),
      new DefaultCompensationRunner(async () => null, async () => {}),
      new DefaultApprovalCoordinator(async () => {}),
      new DefaultDeadLetterSink({ onInbound: () => {}, emit: async () => {} }),
      new DefaultAuditTrail(),
      new DefaultWorkflowLogger(),
      new DefaultWorkflowMetrics(),
      new DefaultWorkflowEventBridge(async () => {}),
      store,
      async () => definition(),
    );
    await dryEngine.start({ definition: definition(), trigger: {}, workflowId: "wf-dry", correlationId: "corr-dry" });
    const done = await waitFor(dryEngine, "wf-dry", (i) => i.state === "COMPLETED");
    deepStrictEqual(writerCalls, ["writer"]);
    strictEqual(done.context.data.boundedExecution, undefined);
  });

  it("legacy: non-CEO bounded markers keep existing resume behavior", async () => {
    const writerCalls = [];
    const { engine, instances } = harness("ADVANCE", (id) => writerCalls.push(id));
    await engine.start({ definition: definition(), trigger: {}, workflowId: "wf-legacy", correlationId: "corr-legacy" });
    await waitFor(engine, "wf-legacy", (i) => i.state === "COMPLETED");
    deepStrictEqual(writerCalls, ["writer"]);
    strictEqual(instances.size, 1);
  });
});
