/**
 * Unit tests for Planner Agent.
 */

import { describe, it, beforeEach } from "node:test";
import { strictEqual, ok, deepStrictEqual, rejects } from "node:assert";
import { PlannerAgent, createPlannerAgent, DEFAULT_PLANNER_SYSTEM_PROMPT } from "@ai-media-factory/planner-agent";
import type { PlannerAgentDependencies, PlannerConfig, PlannerInput, ExecutionPlan, PlanTask } from "@ai-media-factory/planner-agent";
import type { ExecutionContext, ExecutionResponse, CancellationToken, AgentExecutionInput, AgentExecutionOutput } from "@ai-media-factory/runtime";
import type { Json } from "@ai-media-factory/runtime";

// Proper CancellationToken implementation
class MockCancellationToken implements CancellationToken {
  #cancelled = false;
  #handlers: Array<() => void> = [];

  get isCancelled(): boolean {
    return this.#cancelled;
  }

  onCancelled(handler: () => void): void {
    this.#handlers.push(handler);
  }

  throwIfCancelled(): void {
    if (this.#cancelled) {
      throw new Error("Cancelled");
    }
  }

  cancel(): void {
    this.#cancelled = true;
    this.#handlers.forEach((h) => h());
  }
}

function createCancellationToken(cancelled = false): CancellationToken {
  const token = new MockCancellationToken();
  if (cancelled) token.cancel();
  return token;
}

// Mock dependencies
function createMockDeps(overrides: Partial<PlannerAgentDependencies> = {}): PlannerAgentDependencies {
  const mockExecute = async (request: ExecutionContext, signal: CancellationToken): Promise<ExecutionResponse> => {
    // Extract objective from the input event payload
    const payload = request.inputEvent?.payload as Record<string, unknown> | undefined;
    const objective = (payload?.objective as string) ?? "Test objective";

    // Return a mock plan response
    const mockPlan: ExecutionPlan = {
      planId: "test-plan-id",
      objective,
      tasks: [
        {
          id: "task-1",
          name: "Task 1",
          description: "First task",
          agent: "research",
          inputSchema: { type: "object", properties: {} },
          outputSchema: { type: "object", properties: {} },
          dependencies: [],
          estimatedCostUsd: 0.01,
          estimatedDurationSeconds: 30,
          parallelizable: false,
        },
        {
          id: "task-2",
          name: "Task 2",
          description: "Second task",
          agent: "write",
          inputSchema: { type: "object", properties: {} },
          outputSchema: { type: "object", properties: {} },
          dependencies: ["task-1"],
          estimatedCostUsd: 0.01,
          estimatedDurationSeconds: 30,
          parallelizable: false,
        },
      ],
      estimatedTotalCostUsd: 0.02,
      estimatedTotalDurationSeconds: 60,
      hasParallelism: false,
      metadata: {
        createdAt: new Date().toISOString(),
        plannerVersion: "1.0.0",
        taskCount: 2,
        parallelGroupCount: 1,
        confidence: 0.9,
        warnings: [],
      },
    };

    return {
      output: mockPlan as unknown as Json,
      raw: JSON.stringify(mockPlan),
      usage: { inputTokens: 100, outputTokens: 200, costUsd: 0.001 },
      model: "test-model",
      provider: "test",
      latencyMs: 100,
    };
  };

  const defaultConfig: PlannerConfig = {
    model: "test-model",
    temperature: 0.2,
    maxOutputTokens: 4096,
    systemPrompt: DEFAULT_PLANNER_SYSTEM_PROMPT,
    includeReasoning: false,
  };

  return {
    execute: mockExecute,
    config: defaultConfig,
    availableAgents: [
      { id: "research", name: "Research Agent", capabilities: ["web-search", "data-processing"] },
      { id: "write", name: "Write Agent", capabilities: ["text-generation"] },
    ],
    ...overrides,
  };
}

function createTestExecutionContext(objective = "Create a blog post about AI"): ExecutionContext {
  return {
    turnId: "turn-1",
    config: {
      schema_version: "1.0",
      agent: { id: "planner", name: "Planner", layer: "planning", version: "1.0.0" },
      model: { primary: "test-model", temperature: 0.2, max_output_tokens: 4096 },
      tools: { allow: [], deny: [] },
      budgets: { max_cost_usd: 1.0 },
      guardrails: {},
      escalation: { to: "human", triggers: [], timeout_seconds: 60 },
      memory: { long_term_ref: "ltm", short_term_ref: "stm" },
      io: { input_schema: {}, output_schema: {} },
    } as any,
    prompts: { system: "", instructions: "", examples: "" },
    schemas: { input: {}, output: {} },
    memory: { shortTerm: [], longTerm: [], company: [], workflow: [], lessons: [] },
    inputEvent: {
      schema_version: "1.0",
      event_id: "evt-1",
      workflow_id: "wf-1",
      timestamp: new Date().toISOString(),
      type: "PlanRequested",
      source_agent: "user",
      target_agent: "planner",
      payload: { objective },
      metadata: {},
    },
    budgetCeilingUsd: 1.0,
    deadline: new Date(Date.now() + 60000),
  };
}

function createPlannerInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    requestId: "req-1",
    objective: "Create a blog post about AI",
    maxSteps: 5,
    preferredCapabilities: ["web-search", "text-generation"],
    ...overrides,
  };
}

describe("PlannerAgent Unit Tests", () => {
  let agent: PlannerAgent;
  let deps: PlannerAgentDependencies;
  let context: ExecutionContext;

  beforeEach(() => {
    deps = createMockDeps();
    agent = new PlannerAgent(deps);
    context = createTestExecutionContext();
  });

  describe("constructor", () => {
    it("should create agent with correct identity", () => {
      strictEqual(agent.id, "planner");
      strictEqual(agent.name, "Planner Agent");
      strictEqual(agent.version, "1.0.0");
    });

    it("should store config and available agents", () => {
      const customAgent = new PlannerAgent({
        ...deps,
        config: { ...deps.config, model: "custom-model" },
        availableAgents: [{ id: "custom", name: "Custom", capabilities: ["custom"] }],
      });
      ok(customAgent);
    });
  });

  describe("execute", () => {
    it("should execute and return a valid plan", async () => {
      const input: AgentExecutionInput = {
        context,
        input: createPlannerInput(),
      };

      const result = await agent.execute(input, createCancellationToken());

      ok(result);
      ok(result.output);
      ok(result.response);
      strictEqual(result.response.model, "test-model");
      strictEqual(result.response.provider, "planner");
    });

    it("should return plan with correct structure", async () => {
      const input: AgentExecutionInput = {
        context,
        input: createPlannerInput(),
      };

      const result = await agent.execute(input, createCancellationToken());

      const plan = result.output as ExecutionPlan;
      ok(plan.planId);
      strictEqual(plan.objective, "Create a blog post about AI");
      ok(Array.isArray(plan.tasks));
      strictEqual(plan.tasks.length, 2);
      ok(plan.estimatedTotalCostUsd > 0);
      ok(plan.estimatedTotalDurationSeconds > 0);
      ok(typeof plan.hasParallelism === "boolean");
      ok(plan.metadata);
      ok(plan.metadata.taskCount === 2);
    });

    it("should handle different objectives", async () => {
      const testObjective = "Analyze market trends";
      const testContext = createTestExecutionContext(testObjective);
      const input: AgentExecutionInput = {
        context: testContext,
        input: createPlannerInput({ objective: testObjective }),
      };

      const result = await agent.execute(input, createCancellationToken());
      const plan = result.output as ExecutionPlan;
      strictEqual(plan.objective, testObjective);
    });

    it("should respect maxSteps constraint", async () => {
      const input: AgentExecutionInput = {
        context,
        input: createPlannerInput({ maxSteps: 3 }),
      };

      const result = await agent.execute(input, createCancellationToken());
      const plan = result.output as ExecutionPlan;
      ok(plan.tasks.length <= 3);
    });

    it("should include available agents in planning", async () => {
      const customDeps = createMockDeps({
        availableAgents: [
          { id: "agent1", name: "Agent 1", capabilities: ["cap1"] },
          { id: "agent2", name: "Agent 2", capabilities: ["cap2"] },
        ],
      });
      const customAgent = new PlannerAgent(customDeps);

      const input: AgentExecutionInput = {
        context,
        input: createPlannerInput(),
      };

      const result = await customAgent.execute(input, createCancellationToken());
      ok(result);
    });
  });

  describe("createPlannerAgent factory", () => {
    it("should create agent with default config", () => {
      const factoryAgent = createPlannerAgent({ execute: deps.execute, config: {} });
      ok(factoryAgent);
      strictEqual(factoryAgent.id, "planner");
    });

    it("should merge provided config with defaults", () => {
      const factoryAgent = createPlannerAgent({
        execute: deps.execute,
        config: { model: "custom-model", temperature: 0.5 },
      });
      ok(factoryAgent);
    });

    it("should use provided availableAgents", () => {
      const factoryAgent = createPlannerAgent({
        execute: deps.execute,
        config: {},
        availableAgents: [{ id: "test", name: "Test", capabilities: ["test"] }],
      });
      ok(factoryAgent);
    });
  });

  describe("plan parsing", () => {
    it("should validate required plan fields", async () => {
      // Test with a mock that returns invalid plan
      const badDeps = createMockDeps({
        execute: async () => ({
          output: { invalid: "plan" } as Json,
          raw: "{}",
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          model: "test",
          provider: "test",
          latencyMs: 0,
        }),
      });
      const badAgent = new PlannerAgent(badDeps);

      const input: AgentExecutionInput = {
        context,
        input: createPlannerInput(),
      };

      await rejects(
        () => badAgent.execute(input, createCancellationToken()),
        /Invalid plan response/
      );
    });

    it("should calculate totals when not provided", async () => {
      const customDeps = createMockDeps({
        execute: async () => ({
          output: {
            planId: "test",
            objective: "Test",
            tasks: [
              { id: "t1", name: "Task 1", description: "Desc", agent: "research", inputSchema: {}, outputSchema: {}, dependencies: [], estimatedCostUsd: 0.01, estimatedDurationSeconds: 30, parallelizable: false },
            ],
            estimatedTotalCostUsd: null,
            estimatedTotalDurationSeconds: null,
            hasParallelism: false,
            metadata: { createdAt: new Date().toISOString(), plannerVersion: "1.0.0", taskCount: 1, parallelGroupCount: 1, confidence: 0.8, warnings: [] },
          } as unknown as Json,
          raw: "{}",
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          model: "test",
          provider: "test",
          latencyMs: 0,
        }),
      });
      const customAgent = new PlannerAgent(customDeps);

      const input: AgentExecutionInput = {
        context,
        input: createPlannerInput(),
      };

      const result = await customAgent.execute(input, createCancellationToken());
      const plan = result.output as ExecutionPlan;
      ok(plan.estimatedTotalCostUsd > 0);
      ok(plan.estimatedTotalDurationSeconds > 0);
    });
  });

  describe("parallel group counting", () => {
    it("should count parallel groups correctly", async () => {
      // The internal method is private, but we can test via the metadata output
      const customDeps = createMockDeps({
        execute: async () => ({
          output: {
            planId: "test",
            objective: "Test",
            tasks: [
              { id: "t1", name: "Task 1", description: "Desc", agent: "a", inputSchema: {}, outputSchema: {}, dependencies: [], estimatedCostUsd: 0.01, estimatedDurationSeconds: 30, parallelizable: true },
              { id: "t2", name: "Task 2", description: "Desc", agent: "b", inputSchema: {}, outputSchema: {}, dependencies: [], estimatedCostUsd: 0.01, estimatedDurationSeconds: 30, parallelizable: true },
              { id: "t3", name: "Task 3", description: "Desc", agent: "c", inputSchema: {}, outputSchema: {}, dependencies: ["t1", "t2"], estimatedCostUsd: 0.01, estimatedDurationSeconds: 30, parallelizable: false },
            ],
            estimatedTotalCostUsd: 0.03,
            estimatedTotalDurationSeconds: 90,
            hasParallelism: true,
            metadata: { createdAt: new Date().toISOString(), plannerVersion: "1.0.0", taskCount: 3, parallelGroupCount: null, confidence: 0.8, warnings: [] },
          } as unknown as Json,
          raw: "{}",
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          model: "test",
          provider: "test",
          latencyMs: 0,
        }),
      });
      const customAgent = new PlannerAgent(customDeps);

      const input: AgentExecutionInput = {
        context,
        input: createPlannerInput(),
      };

      const result = await customAgent.execute(input, createCancellationToken());
      const plan = result.output as ExecutionPlan;
      ok(plan.metadata.parallelGroupCount >= 2); // t1 and t2 can run in parallel, t3 depends on both
    });
  });

  describe("duration calculation", () => {
    it("should calculate critical path duration", async () => {
      const customDeps = createMockDeps({
        execute: async () => ({
          output: {
            planId: "test",
            objective: "Test",
            tasks: [
              { id: "t1", name: "Task 1", description: "Desc", agent: "a", inputSchema: {}, outputSchema: {}, dependencies: [], estimatedCostUsd: 0.01, estimatedDurationSeconds: 30, parallelizable: false },
              { id: "t2", name: "Task 2", description: "Desc", agent: "b", inputSchema: {}, outputSchema: {}, dependencies: ["t1"], estimatedCostUsd: 0.01, estimatedDurationSeconds: 30, parallelizable: false },
              { id: "t3", name: "Task 3", description: "Desc", agent: "c", inputSchema: {}, outputSchema: {}, dependencies: ["t2"], estimatedCostUsd: 0.01, estimatedDurationSeconds: 30, parallelizable: false },
            ],
            estimatedTotalCostUsd: 0.03,
            estimatedTotalDurationSeconds: null,
            hasParallelism: false,
            metadata: { createdAt: new Date().toISOString(), plannerVersion: "1.0.0", taskCount: 3, parallelGroupCount: 1, confidence: 0.8, warnings: [] },
          } as unknown as Json,
          raw: "{}",
          usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
          model: "test",
          provider: "test",
          latencyMs: 0,
        }),
      });
      const customAgent = new PlannerAgent(customDeps);

      const input: AgentExecutionInput = {
        context,
        input: createPlannerInput(),
      };

      const result = await customAgent.execute(input, createCancellationToken());
      const plan = result.output as ExecutionPlan;
      // Critical path: t1(30) -> t2(30) -> t3(30) = 90
      strictEqual(plan.estimatedTotalDurationSeconds, 90);
    });
  });
});