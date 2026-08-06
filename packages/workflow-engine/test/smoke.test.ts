/**
 * Smoke tests for Workflow Engine.
 */

import { describe, it, beforeEach } from "node:test";
import { strictEqual, ok } from "node:assert";
import {
  DefaultWorkflowEngine,
  WorkflowBuilder,
  workflow,
  DefaultWorkflowStateMachine,
  DefaultTimeoutController,
  DefaultWorkflowRetryPolicy,
  DefaultScheduler,
  DefaultBranchRouter,
  DefaultWorkflowLogger,
  DefaultWorkflowMetrics,
  DefaultWorkflowEventBridge,
} from "@ai-media-factory/workflow-engine";
import type {
  WorkflowDefinition,
  StartInput,
  WorkflowInstance,
  WorkflowState,
} from "@ai-media-factory/workflow-engine";

// Simple mock agent runtime for smoke tests
class MockAgentRuntime {
  async run(input: any) {
    return {
      status: "COMPLETED",
      turnId: `turn-${Date.now()}`,
      emitted: { payload: { result: `completed ${input.event.type}` } },
      costUsd: 0.001,
      durationMs: 100,
    };
  }
}

// Simple mock checkpoint store
class MockCheckpointStore {
  private store = new Map();
  
  async save(scope: string, record: any) {
    this.store.set(record.memory_id, record);
    return { id: record.memory_id, version: 1 };
  }
  
  async retrieve(query: any) {
    return { records: Array.from(this.store.values()), totalConfidence: 0 };
  }
}

function createTestEngine() {
  const agentRuntime = new MockAgentRuntime();
  const checkpointStore = new MockCheckpointStore();
  const stateMachine = new DefaultWorkflowStateMachine();
  const timeoutController = new DefaultTimeoutController();
  const retryPolicy = new DefaultWorkflowRetryPolicy();
  const scheduler = new DefaultScheduler();
  const branchRouter = new DefaultBranchRouter();
  
  const checkpointCoordinator = {
    checkpoint: async (instance: WorkflowInstance) => ({
      workflowId: instance.workflowId,
      state: instance.state,
      completedSteps: instance.steps.filter(s => s.status === "completed").map(s => s.stepId),
      contextSnapshotRef: `ctx-${instance.workflowId}`,
      lastEventOffset: 0,
      createdAt: new Date().toISOString(),
    }),
    latest: async (workflowId: string) => null,
  };
  
  const instances = new Map<string, WorkflowInstance>();
  const getWorkflowInstance = async (workflowId: string) => instances.get(workflowId) ?? null;
  
  const recoveryManager = {
    recover: async (workflowId: string) => getWorkflowInstance(workflowId),
    isRecoverable: async () => false,
  };
  
  const compensationRunner = {
    plan: (instance: WorkflowInstance) => ({ steps: [] }),
    compensate: async () => {},
  };
  
  const approvalCoordinator = {
    request: async () => {},
    apply: async () => {},
    waitForApproval: async () => ({ workflowId: "", stepId: "", outcome: "approved" as const, approver: "", note: null, decidedAt: new Date().toISOString() }),
  };
  
  const deadLetterSink = {
    deadLetter: async () => {},
    replay: async () => {},
  };
  
  const auditTrail = {
    append: async () => {},
    history: async () => [],
  };
  
  const logger = new DefaultWorkflowLogger();
  const metrics = new DefaultWorkflowMetrics();
  const eventBridge = new DefaultWorkflowEventBridge(async () => {});
  
  const stepExecutor = {
    execute: async (step: any, context: any) => ({
      status: "completed",
      output: { result: "ok" },
    }),
  };
  
  return new DefaultWorkflowEngine(
    stepExecutor,
    scheduler,
    stateMachine,
    checkpointCoordinator,
    recoveryManager,
    compensationRunner,
    approvalCoordinator,
    deadLetterSink,
    auditTrail,
    logger,
    metrics,
    eventBridge
  );
}

function createSimpleWorkflow(): WorkflowDefinition {
  return workflow()
    .id("smoke-test-workflow")
    .version(1)
    .trigger("event", "ExecutiveDirective")
    .entryStep("step-1")
    .timeoutSeconds(60)
    .addAgentStep({ id: "step-1", agent: "research", emits: "ResearchCompleted", next: "step-2" })
    .addAgentStep({ id: "step-2", agent: "write", emits: "WriteCompleted" })
    .build();
}

describe("Workflow Engine Smoke Tests", () => {
  let engine: DefaultWorkflowEngine;

  beforeEach(() => {
    engine = createTestEngine();
  });

  it("should create a workflow definition using builder", () => {
    const definition = createSimpleWorkflow();
    
    strictEqual(definition.id, "smoke-test-workflow");
    strictEqual(definition.version, 1);
    strictEqual(definition.trigger.kind, "event");
    strictEqual(definition.entryStep, "step-1");
    strictEqual(definition.steps.length, 2);
  });

  it("should start a workflow instance", async () => {
    const input: StartInput = {
      definition: createSimpleWorkflow(),
      trigger: { directive: "test" },
      correlationId: "corr-1",
      brandId: "brand-1",
    };
    
    const instance = await engine.start(input);
    
    ok(instance);
    strictEqual(instance.definitionId, "smoke-test-workflow");
    strictEqual(instance.definitionVersion, 1);
    strictEqual(instance.state, "RUNNING");
    ok(instance.workflowId.startsWith("wf-"));
    strictEqual(instance.context.correlationId, "corr-1");
    strictEqual(instance.context.brandId, "brand-1");
    strictEqual(instance.ready.length, 1);
    strictEqual(instance.ready[0], "step-1");
  });

  it("should pause a workflow", async () => {
    const instance = await engine.start({
      definition: createSimpleWorkflow(),
      trigger: { directive: "test" },
    });
    
    await engine.pause(instance.workflowId, "user requested");
    
    const paused = await engine.describe(instance.workflowId);
    ok(paused);
    strictEqual(paused!.state, "PAUSED");
  });

  it("should cancel a workflow", async () => {
    const instance = await engine.start({
      definition: createSimpleWorkflow(),
      trigger: { directive: "test" },
    });
    
    await engine.cancel(instance.workflowId, "test cancellation");
    
    const cancelled = await engine.describe(instance.workflowId);
    ok(cancelled);
    strictEqual(cancelled!.state, "CANCELLED");
  });

  it("should handle approval signal", async () => {
    const instance = await engine.start({
      definition: createSimpleWorkflow(),
      trigger: { directive: "test" },
    });
    
    await engine.signalApproval(instance.workflowId, {
      workflowId: instance.workflowId,
      stepId: "step-1",
      outcome: "approved",
      approver: "ceo",
      note: "approved",
      decidedAt: new Date().toISOString(),
    });
    
    ok(true); // No error thrown
  });

  it("should describe workflow state", async () => {
    const instance = await engine.start({
      definition: createSimpleWorkflow(),
      trigger: { directive: "test" },
    });
    
    const described = await engine.describe(instance.workflowId);
    ok(described);
    strictEqual(described!.workflowId, instance.workflowId);
  });

  it("should return null for non-existent workflow", async () => {
    const result = await engine.describe("non-existent");
    strictEqual(result, null);
  });

  it("should transition state machine correctly", () => {
    const sm = new DefaultWorkflowStateMachine();
    
    strictEqual(sm.next("PENDING", "start"), "RUNNING");
    strictEqual(sm.next("RUNNING", "pause"), "PAUSED");
    strictEqual(sm.next("PAUSED", "resume"), "RUNNING");
    strictEqual(sm.next("RUNNING", "complete"), "COMPLETED");
    strictEqual(sm.next("AWAITING_APPROVAL", "approve"), "RUNNING");
    strictEqual(sm.next("AWAITING_APPROVAL", "reject"), "FAILED");
    
    ok(sm.isTerminal("COMPLETED"));
    ok(sm.isTerminal("FAILED"));
    ok(!sm.isTerminal("RUNNING"));
  });

  it("should calculate timeouts", () => {
    const tc = new DefaultTimeoutController();
    
    const stepDeadline = tc.stepDeadline("step-1", 60);
    ok(stepDeadline > new Date());
    
    const workflowDeadline = tc.workflowDeadline("wf-1", 300);
    ok(workflowDeadline > new Date());
    
    ok(tc.isExpired(new Date(Date.now() - 1000)));
    ok(!tc.isExpired(new Date(Date.now() + 1000)));
  });

  it("should apply retry policy", () => {
    const rp = new DefaultWorkflowRetryPolicy();
    
    ok(rp.shouldRetry({ message: "temp error", retryable: true }, 0));
    ok(rp.shouldRetry({ message: "temp error", retryable: true }, 1));
    ok(!rp.shouldRetry({ message: "perm error", retryable: false }, 0));
    ok(!rp.shouldRetry({ message: "temp error", retryable: true }, 3));
    
    const delay = rp.backoffMs(1);
    ok(delay > 0);
  });

  it("should schedule ready steps", () => {
    const sched = new DefaultScheduler();
    
    const instance: WorkflowInstance = {
      workflowId: "wf-1",
      definitionId: "test",
      definitionVersion: 1,
      state: "RUNNING",
      context: { workflowId: "wf-1", correlationId: null, brandId: null, outputs: {}, data: {} },
      steps: [
        { stepId: "step-1", status: "pending", attempts: 0, startedAt: null, finishedAt: null },
        { stepId: "step-2", status: "completed", attempts: 1, startedAt: null, finishedAt: null },
      ],
      ready: ["step-1"],
      lastCheckpointRef: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    const ready = sched.readySteps(instance);
    strictEqual(ready.length, 1);
    strictEqual(ready[0], "step-1");
  });

  it("should route branches", () => {
    const router = new DefaultBranchRouter();
    
    const step = {
      id: "branch-1",
      kind: "branch" as const,
      cases: [
        { when: { action: "approve" }, goto: "step-approved" },
        { when: { action: "reject" }, goto: "step-rejected" },
      ],
      otherwise: "step-default",
    };
    
    const context = {
      workflowId: "wf-1",
      correlationId: null,
      brandId: null,
      outputs: {},
      data: { action: "approve" },
    };
    
    strictEqual(router.choose(step, context), "step-approved");
    
    context.data = { action: "reject" };
    strictEqual(router.choose(step, context), "step-rejected");
    
    context.data = { action: "unknown" };
    strictEqual(router.choose(step, context), "step-default");
  });

  it("should log without errors", () => {
    const logger = new DefaultWorkflowLogger();
    logger.log("info", "Test message", { workflow_id: "wf-1" });
    logger.log("warn", "Warning", { step_id: "step-1" });
    logger.log("error", "Error", { workflow_id: "wf-1", state: "FAILED" });
    ok(true);
  });

  it("should track metrics", () => {
    const metrics = new DefaultWorkflowMetrics();
    
    metrics.recordCompletion("wf-1", {
      cycleTimeMs: 5000,
      stepCount: 2,
      retries: 0,
      reworkLoops: 0,
      autonomyRate: 1,
      estimatedCostUsd: 0.01,
      actualCostUsd: 0.01,
    });
    
    metrics.recordOutcome("wf-1", "completed");
    
    const snapshot = metrics.snapshot();
    ok(snapshot.running >= 0);
    ok(snapshot.successRate >= 0);
  });

  it("should handle event bridge", async () => {
    const bridge = new DefaultWorkflowEventBridge(async () => {});
    let received = false;
    
    bridge.onInbound("ExecutiveDirective", async () => {
      received = true;
    });
    
    await bridge.dispatchInbound("ExecutiveDirective", { test: true });
    ok(received);
  });
});