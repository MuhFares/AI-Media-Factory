import test from "node:test";
import { deepStrictEqual, strictEqual } from "node:assert";
import {
  DefaultWorkflowEngine, DefaultWorkflowStateMachine, DefaultTimeoutController,
  DefaultWorkflowRetryPolicy, DefaultScheduler, DefaultBranchRouter,
  DefaultCheckpointCoordinator, DefaultRecoveryManager, DefaultCompensationRunner,
  DefaultApprovalCoordinator, DefaultStepExecutor, DefaultDeadLetterSink,
  DefaultAuditTrail, DefaultWorkflowLogger, DefaultWorkflowMetrics, DefaultWorkflowEventBridge,
} from "@ai-media-factory/workflow-engine";

const definition = {
  id: "research-business-stop", version: 1, trigger: { kind: "event", spec: "Test" }, entryStep: "research",
  steps: [
    { id: "research", kind: "agent", agent: "research", emits: "research", next: "ceo-recommendation" },
    { id: "ceo-recommendation", kind: "agent", agent: "ceo", emits: "ceo" },
  ],
  timeoutSeconds: 60, compensation: { onFailure: true, onCancel: true },
};

function harness(researchStatus: string, technicalFailure = false) {
  const instances = new Map<string, any>();
  const ceoCalls: string[] = [];
  const store = {
    loadWorkflow: async (id: string) => instances.get(id) ?? null,
    async saveWorkflow(instance: any) { instances.set(instance.workflowId, instance); },
    async listDecisions() { return []; }, async saveDecision() { return null; }, async saveArtifact() { return null; },
  };
  const executor = {
    async executeAgentStep(step: any, context: any) {
      if (step.id !== "research") { ceoCalls.push(step.id); return { status: "completed", output: {} }; }
      if (technicalFailure) return { status: "failed", output: {}, error: { message: "STRUCTURAL_VALIDATION_FAILED", retryable: false } };
      const payload = { researchStatus, evidenceQuality: { ceoEligible: false, evidenceStatus: researchStatus } };
      return { status: "completed", output: payload, artifact: { artifactId: `art-${context.workflowId}-research`, kind: "research_report", producerAgent: "research", workflowId: context.workflowId, correlationId: context.correlationId ?? "", status: "completed", payload, contentType: "application/json", schemaVersion: "1.0", createdAt: new Date().toISOString() } };
    },
  };
  const checkpoint = new DefaultCheckpointCoordinator();
  const engine = new DefaultWorkflowEngine(
    new DefaultStepExecutor(executor, new DefaultBranchRouter(), new DefaultScheduler(), new DefaultTimeoutController(), new DefaultWorkflowRetryPolicy(), checkpoint, async (id) => instances.get(id) ?? null, new DefaultWorkflowStateMachine()),
    new DefaultScheduler(), new DefaultWorkflowStateMachine(), checkpoint,
    new DefaultRecoveryManager(checkpoint, store, async () => null),
    new DefaultCompensationRunner(async () => null, async () => {}), new DefaultApprovalCoordinator(async () => {}),
    new DefaultDeadLetterSink({ onInbound: () => {}, emit: async () => {} }), new DefaultAuditTrail(),
    new DefaultWorkflowLogger(), new DefaultWorkflowMetrics(), new DefaultWorkflowEventBridge(async () => {}),
    store, async () => definition as any,
  );
  return { engine, ceoCalls };
}

async function waitFor(engine: any, workflowId: string, states: string[]) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const instance = await engine.describe(workflowId);
    if (instance && states.includes(instance.state)) return instance;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timeout");
}

test("Research NEEDS_VERIFICATION pauses at the canonical bounded business stop", async () => {
  const { engine, ceoCalls } = harness("NEEDS_VERIFICATION");
  await engine.start({ definition: definition as any, trigger: { researchIntelligenceVersion: "V2" }, workflowId: "wf-needs-verification", correlationId: "corr" } as any);
  const halted = await waitFor(engine, "wf-needs-verification", ["PAUSED", "FAILED"]);
  strictEqual(halted.state, "PAUSED");
  strictEqual(halted.context.data.boundedStop.reason, "RESEARCH_NEEDS_VERIFICATION");
  strictEqual(halted.steps.find((step: any) => step.stepId === "research").status, "completed");
  deepStrictEqual(ceoCalls, []);
});
test("Research structural failure remains a technical FAILED state", async () => {
  const { engine, ceoCalls } = harness("NEEDS_VERIFICATION", true);
  await engine.start({ definition: definition as any, trigger: { researchIntelligenceVersion: "V2" }, workflowId: "wf-technical", correlationId: "corr" } as any);
  const failed = await waitFor(engine, "wf-technical", ["PAUSED", "FAILED"]);
  strictEqual(failed.state, "FAILED");
  strictEqual(failed.context.data.boundedStop, undefined);
  deepStrictEqual(ceoCalls, []);
});
