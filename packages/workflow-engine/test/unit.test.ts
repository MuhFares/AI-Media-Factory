/**
 * Unit tests for Workflow Engine.
 */

import { describe, it, beforeEach } from "node:test";
import { strictEqual, ok, deepStrictEqual, rejects } from "node:assert";
import {
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
  DefaultWorkflowEngine,
  WorkflowBuilder,
  workflow,
} from "@ai-media-factory/workflow-engine";
import type {
  WorkflowState,
  WorkflowDefinition,
  Step,
  AgentStep,
  BranchStep,
  ParallelStep,
  GateStep,
  CompensationStep,
  WorkflowContext,
  WorkflowInstance,
  StepRecord,
  StartInput,
} from "@ai-media-factory/workflow-engine";

// Mock implementations for dependencies
class MockAgentRuntime {
  async run(input: any) {
    return {
      status: "COMPLETED",
      turnId: "turn-1",
      emitted: { payload: { result: "success" } },
      costUsd: 0.001,
      durationMs: 100,
    };
  }
}

class MockCheckpointStore {
  async save() { return { id: "checkpoint-1", version: 1 }; }
  async retrieve() { return { records: [], totalConfidence: 0 }; }
}

function createMockDependencies() {
  const agentRuntime = new MockAgentRuntime();
  const checkpointStore = new MockCheckpointStore();
  const stateMachine = new DefaultWorkflowStateMachine();
  const timeoutController = new DefaultTimeoutController();
  const retryPolicy = new DefaultWorkflowRetryPolicy();
  const scheduler = new DefaultScheduler();
  const branchRouter = new DefaultBranchRouter();
  const checkpointCoordinator = new DefaultCheckpointCoordinator(() => checkpointStore);
  
  const instances = new Map<string, WorkflowInstance>();
  const getWorkflowInstance = async (workflowId: string) => instances.get(workflowId) ?? null;
  
  const recoveryManager = new DefaultRecoveryManager(
    checkpointCoordinator,
    getWorkflowInstance,
    async () => null
  );
  
  const compensationRunner = new DefaultCompensationRunner(
    async () => null,
    async () => {}
  );
  
  const approvalCoordinator = new DefaultApprovalCoordinator(async () => {});
  
  const deadLetterSink = new DefaultDeadLetterSink({
    onInbound: () => {},
    emit: async () => {},
  } as any);
  
  const auditTrail = new DefaultAuditTrail();
  const logger = new DefaultWorkflowLogger();
  const metrics = new DefaultWorkflowMetrics();
  const eventBridge = new DefaultWorkflowEventBridge(async () => {});
  
  const stepExecutor = new DefaultStepExecutor(
    agentRuntime,
    branchRouter,
    scheduler,
    timeoutController,
    retryPolicy,
    checkpointCoordinator,
    getWorkflowInstance,
    stateMachine
  );

  return {
    stateMachine,
    timeoutController,
    retryPolicy,
    scheduler,
    branchRouter,
    checkpointCoordinator,
    recoveryManager,
    compensationRunner,
    approvalCoordinator,
    deadLetterSink,
    auditTrail,
    logger,
    metrics,
    eventBridge,
    stepExecutor,
    instances,
  };
}

function createTestWorkflowDefinition(): WorkflowDefinition {
  return {
    id: "test-workflow",
    version: 1,
    trigger: { kind: "event", spec: "ExecutiveDirective" },
    entryStep: "step-1",
    steps: [
      {
        id: "step-1",
        kind: "agent",
        agent: "research",
        emits: "ResearchCompleted",
        next: "step-2",
      },
      {
        id: "step-2",
        kind: "agent",
        agent: "write",
        emits: "WriteCompleted",
      },
    ],
    timeoutSeconds: 300,
    compensation: { onFailure: true, onCancel: true },
  };
}

function createTestInstance(workflowId: string = "wf-1"): WorkflowInstance {
  const definition = createTestWorkflowDefinition();
  return {
    workflowId,
    definitionId: definition.id,
    definitionVersion: definition.version,
    state: "PENDING",
    context: {
      workflowId,
      correlationId: null,
      brandId: null,
      outputs: {},
      data: {},
    },
    steps: definition.steps.map((step) => ({
      stepId: step.id,
      status: "pending",
      attempts: 0,
      startedAt: null,
      finishedAt: null,
    })),
    ready: [definition.entryStep],
    lastCheckpointRef: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("Workflow Engine Unit Tests", () => {
  let deps: ReturnType<typeof createMockDependencies>;

  beforeEach(() => {
    deps = createMockDependencies();
  });

  describe("DefaultWorkflowStateMachine", () => {
    it("should allow valid transitions", () => {
      ok(deps.stateMachine.can("PENDING", "start"));
      ok(deps.stateMachine.can("RUNNING", "pause"));
      ok(deps.stateMachine.can("RUNNING", "complete"));
      ok(deps.stateMachine.can("AWAITING_APPROVAL", "approve"));
      ok(deps.stateMachine.can("RETRYING", "retry_ready"));
    });

    it("should reject invalid transitions", () => {
      ok(!deps.stateMachine.can("PENDING", "pause"));
      ok(!deps.stateMachine.can("COMPLETED", "start"));
      ok(!deps.stateMachine.can("FAILED", "complete"));
    });

    it("should return correct next state", () => {
      strictEqual(deps.stateMachine.next("PENDING", "start"), "RUNNING");
      strictEqual(deps.stateMachine.next("RUNNING", "pause"), "PAUSED");
      strictEqual(deps.stateMachine.next("AWAITING_APPROVAL", "approve"), "RUNNING");
      strictEqual(deps.stateMachine.next("AWAITING_APPROVAL", "reject"), "FAILED");
    });

    it("should identify terminal states", () => {
      ok(deps.stateMachine.isTerminal("COMPLETED"));
      ok(deps.stateMachine.isTerminal("FAILED"));
      ok(deps.stateMachine.isTerminal("CANCELLED"));
      ok(deps.stateMachine.isTerminal("ESCALATED"));
      ok(!deps.stateMachine.isTerminal("RUNNING"));
      ok(!deps.stateMachine.isTerminal("PENDING"));
    });
  });

  describe("DefaultTimeoutController", () => {
    it("should calculate step deadline", () => {
      const deadline = deps.timeoutController.stepDeadline("step-1", 60);
      ok(deadline instanceof Date);
      ok(deadline.getTime() > Date.now());
      ok(deadline.getTime() <= Date.now() + 61000);
    });

    it("should calculate workflow deadline", () => {
      const deadline = deps.timeoutController.workflowDeadline("wf-1", 300);
      ok(deadline instanceof Date);
      ok(deadline.getTime() > Date.now());
    });

    it("should detect expired deadlines", () => {
      const past = new Date(Date.now() - 1000);
      ok(deps.timeoutController.isExpired(past));
      
      const future = new Date(Date.now() + 1000);
      ok(!deps.timeoutController.isExpired(future));
    });
  });

  describe("DefaultWorkflowRetryPolicy", () => {
    it("should retry on retryable errors within max attempts", () => {
      ok(deps.retryPolicy.shouldRetry({ message: "error", retryable: true }, 0));
      ok(deps.retryPolicy.shouldRetry({ message: "error", retryable: true }, 1));
      ok(!deps.retryPolicy.shouldRetry({ message: "error", retryable: true }, 3)); // maxAttempts = 3
    });

    it("should not retry non-retryable errors", () => {
      ok(!deps.retryPolicy.shouldRetry({ message: "error", retryable: false }, 0));
    });

    it("should calculate exponential backoff", () => {
      const delay0 = deps.retryPolicy.backoffMs(0);
      const delay1 = deps.retryPolicy.backoffMs(1);
      const delay2 = deps.retryPolicy.backoffMs(2);
      
      ok(delay0 >= 500 && delay0 <= 1500); // baseDelayMs = 1000, jitter
      ok(delay1 >= 1000 && delay1 <= 3000); // 1000 * 2 = 2000, with jitter
      ok(delay2 >= 2000 && delay2 <= 6000); // 1000 * 4 = 4000, with jitter
    });
  });

  describe("DefaultScheduler", () => {
    it("should return ready steps", () => {
      const instance = createTestInstance();
      const ready = deps.scheduler.readySteps(instance);
      deepStrictEqual(ready, ["step-1"]);
    });

    it("should return empty for completed workflow", () => {
      const instance = createTestInstance();
      instance.steps.forEach(s => s.status = "completed");
      instance.ready = [];
      const ready = deps.scheduler.readySteps(instance);
      deepStrictEqual(ready, []);
    });
  });

  describe("DefaultBranchRouter", () => {
    it("should choose matching case", () => {
      const step: BranchStep = {
        id: "branch-1",
        kind: "branch",
        cases: [
          { when: { action: "approve" }, goto: "step-approved" },
          { when: { action: "reject" }, goto: "step-rejected" },
        ],
        otherwise: "step-default",
      };
      
      const context: WorkflowContext = {
        workflowId: "wf-1",
        correlationId: null,
        brandId: null,
        outputs: {},
        data: { action: "approve" },
      };
      
      strictEqual(deps.branchRouter.choose(step, context), "step-approved");
    });

    it("should use otherwise when no case matches", () => {
      const step: BranchStep = {
        id: "branch-1",
        kind: "branch",
        cases: [
          { when: { action: "approve" }, goto: "step-approved" },
        ],
        otherwise: "step-default",
      };
      
      const context: WorkflowContext = {
        workflowId: "wf-1",
        correlationId: null,
        brandId: null,
        outputs: {},
        data: { action: "unknown" },
      };
      
      strictEqual(deps.branchRouter.choose(step, context), "step-default");
    });

    it("should support comparison operators", () => {
      const step: BranchStep = {
        id: "branch-1",
        kind: "branch",
        cases: [
          { when: { score: { $gt: 50 } }, goto: "high-score" },
          { when: { score: { $lt: 50 } }, goto: "low-score" },
        ],
        otherwise: "step-default",
      };
      
      const context1: WorkflowContext = {
        workflowId: "wf-1",
        correlationId: null,
        brandId: null,
        outputs: {},
        data: { score: 75 },
      };
      
      const context2: WorkflowContext = {
        workflowId: "wf-1",
        correlationId: null,
        brandId: null,
        outputs: {},
        data: { score: 25 },
      };
      
      strictEqual(deps.branchRouter.choose(step, context1), "high-score");
      strictEqual(deps.branchRouter.choose(step, context2), "low-score");
    });
  });

  describe("WorkflowBuilder", () => {
    it("should build a valid workflow definition", () => {
      const definition = workflow()
        .id("test-workflow")
        .version(1)
        .trigger("event", "ExecutiveDirective")
        .entryStep("step-1")
        .timeoutSeconds(300)
        .addAgentStep({ id: "step-1", agent: "research", emits: "ResearchCompleted", next: "step-2" })
        .addAgentStep({ id: "step-2", agent: "write", emits: "WriteCompleted" })
        .build();
      
      strictEqual(definition.id, "test-workflow");
      strictEqual(definition.version, 1);
      strictEqual(definition.trigger.kind, "event");
      strictEqual(definition.entryStep, "step-1");
      strictEqual(definition.timeoutSeconds, 300);
      strictEqual(definition.steps.length, 2);
    });

    it("should throw for missing required fields", () => {
      const builder = workflow();
      let threw = false;
      try {
        builder.build();
      } catch (e) {
        threw = true;
        ok(e instanceof Error);
        ok(e.message.includes("Workflow id is required"));
      }
      ok(threw);
      
      const builder2 = workflow().id("test").version(1);
      threw = false;
      try {
        builder2.build();
      } catch (e) {
        threw = true;
        ok(e instanceof Error);
        ok(e.message.includes("Workflow trigger is required"));
      }
      ok(threw);
      
      const builder3 = workflow().id("test").version(1).trigger("event", "ExecutiveDirective");
      threw = false;
      try {
        builder3.build();
      } catch (e) {
        threw = true;
        ok(e instanceof Error);
        ok(e.message.includes("Workflow entryStep is required"));
      }
      ok(threw);
      
      const builder4 = workflow().id("test").version(1).trigger("event", "ExecutiveDirective").entryStep("step-1");
      threw = false;
      try {
        builder4.build();
      } catch (e) {
        threw = true;
        ok(e instanceof Error);
        ok(e.message.includes("Workflow must have at least one step"));
      }
      ok(threw);
    });

    it("should support branch steps", () => {
      const definition = workflow()
        .id("test")
        .version(1)
        .trigger("event", "ExecutiveDirective")
        .entryStep("step-1")
        .addAgentStep({ id: "step-1", agent: "research", emits: "ResearchCompleted", next: "branch-1" })
        .addBranchStep({
          id: "branch-1",
          cases: [{ when: { approved: true }, goto: "step-2" }],
          otherwise: "step-3",
        })
        .addAgentStep({ id: "step-2", agent: "write", emits: "WriteCompleted" })
        .addAgentStep({ id: "step-3", agent: "revise", emits: "ReviseCompleted" })
        .build();
      
      strictEqual(definition.steps.length, 4);
      ok(definition.steps.some(s => s.kind === "branch"));
    });

    it("should support parallel steps", () => {
      const definition = workflow()
        .id("test")
        .version(1)
        .trigger("event", "ExecutiveDirective")
        .entryStep("parallel-1")
        .addParallelStep({
          id: "parallel-1",
          branches: ["step-1", "step-2"],
          join: "join-1",
        })
        .addAgentStep({ id: "step-1", agent: "research", emits: "ResearchCompleted" })
        .addAgentStep({ id: "step-2", agent: "analyze", emits: "AnalyzeCompleted" })
        .addAgentStep({ id: "join-1", agent: "synthesize", emits: "SynthesizeCompleted" })
        .build();
      
      ok(definition.steps.some(s => s.kind === "parallel"));
    });

    it("should support gate steps", () => {
      const definition = workflow()
        .id("test")
        .version(1)
        .trigger("event", "ExecutiveDirective")
        .entryStep("gate-1")
        .addGateStep({
          id: "gate-1",
          approver: "ceo",
          reason: "Budget approval required",
          next: "step-1",
        })
        .addAgentStep({ id: "step-1", agent: "execute", emits: "ExecuteCompleted" })
        .build();
      
      ok(definition.steps.some(s => s.kind === "gate"));
    });
  });

  describe("DefaultAuditTrail", () => {
    it("should record and retrieve audit entries", async () => {
      const entry = {
        workflowId: "wf-1",
        kind: "workflow_started" as const,
        stepId: null,
        detail: { definitionId: "test" },
        at: new Date().toISOString(),
      };
      
      await deps.auditTrail.append(entry);
      const history = await deps.auditTrail.history("wf-1");
      
      strictEqual(history.length, 1);
      strictEqual(history[0].workflowId, "wf-1");
      strictEqual(history[0].kind, "workflow_started");
    });
  });

  describe("DefaultWorkflowLogger", () => {
    it("should log without throwing", () => {
      deps.logger.log("info", "Test message", { workflow_id: "wf-1", step_id: "step-1" });
      deps.logger.log("warn", "Warning", { correlation_id: "corr-1" });
      deps.logger.log("error", "Error occurred", { workflow_id: "wf-1" });
      ok(true);
    });
  });

  describe("DefaultWorkflowMetrics", () => {
    it("should record completions and outcomes", () => {
      deps.metrics.recordCompletion("wf-1", {
        cycleTimeMs: 5000,
        stepCount: 3,
        retries: 1,
        reworkLoops: 0,
        autonomyRate: 1,
        estimatedCostUsd: 0.01,
        actualCostUsd: 0.012,
      });
      
      deps.metrics.recordOutcome("wf-1", "completed");
      
      const snapshot = deps.metrics.snapshot();
      ok(snapshot.running >= 0);
      ok(snapshot.successRate >= 0);
    });
  });

  describe("DefaultWorkflowEventBridge", () => {
    it("should register handlers and emit events", async () => {
      let received = false;
      deps.eventBridge.onInbound("ExecutiveDirective", async () => {
        received = true;
      });
      
      await deps.eventBridge.dispatchInbound("ExecutiveDirective", { test: true });
      ok(received);
    });
  });
});