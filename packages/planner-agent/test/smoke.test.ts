/**
 * Smoke tests for Planner Agent.
 */

import { describe, it, beforeEach } from "node:test";
import { strictEqual, ok, rejects } from "node:assert";
import { PlannerAgent, createPlannerAgent } from "@ai-media-factory/planner-agent";
import type { PlannerAgentDependencies, PlannerConfig, PlannerInput, ExecutionPlan } from "@ai-media-factory/planner-agent";
import type { ExecutionContext, ExecutionResponse, CancellationToken, AgentExecutionInput } from "@ai-media-factory/runtime";
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

// Simple mock that returns a structured plan
function createSmokeDeps(): PlannerAgentDependencies {
  const mockExecute = async (request: ExecutionContext, signal: CancellationToken): Promise<ExecutionResponse> => {
    // Extract objective from the input event payload
    const payload = request.inputEvent?.payload as Record<string, unknown> | undefined;
    const objective = (payload?.objective as string) ?? "Smoke test objective";

    const mockPlan: ExecutionPlan = {
      planId: "smoke-plan-" + Date.now(),
      objective,
      tasks: [
        {
          id: "step-1",
          name: "Research",
          description: "Research the topic",
          agent: "research",
          inputSchema: { type: "object", properties: { topic: { type: "string" } } },
          outputSchema: { type: "object", properties: { findings: { type: "string" } } },
          dependencies: [],
          estimatedCostUsd: 0.005,
          estimatedDurationSeconds: 20,
          parallelizable: false,
        },
        {
          id: "step-2",
          name: "Write",
          description: "Write the content",
          agent: "writer",
          inputSchema: { type: "object", properties: { research: { type: "string" } } },
          outputSchema: { type: "object", properties: { content: { type: "string" } } },
          dependencies: ["step-1"],
          estimatedCostUsd: 0.005,
          estimatedDurationSeconds: 30,
          parallelizable: false,
        },
        {
          id: "step-3",
          name: "Review",
          description: "Review and edit",
          agent: "editor",
          inputSchema: { type: "object", properties: { draft: { type: "string" } } },
          outputSchema: { type: "object", properties: { final: { type: "string" } } },
          dependencies: ["step-2"],
          estimatedCostUsd: 0.002,
          estimatedDurationSeconds: 15,
          parallelizable: false,
        },
      ],
      estimatedTotalCostUsd: 0.012,
      estimatedTotalDurationSeconds: 65,
      hasParallelism: false,
      metadata: {
        createdAt: new Date().toISOString(),
        plannerVersion: "1.0.0",
        taskCount: 3,
        parallelGroupCount: 1,
        confidence: 0.95,
        warnings: [],
      },
    };

    return {
      output: mockPlan as unknown as Json,
      raw: JSON.stringify(mockPlan),
      usage: { inputTokens: 150, outputTokens: 300, costUsd: 0.002 },
      model: "smoke-model",
      provider: "smoke",
      latencyMs: 50,
    };
  };

  return {
    execute: mockExecute,
    config: {
      model: "smoke-model",
      temperature: 0.1,
      maxOutputTokens: 2048,
      systemPrompt: "You are a planner.",
    },
    availableAgents: [
      { id: "research", name: "Researcher", capabilities: ["web-search", "data-processing"] },
      { id: "writer", name: "Writer", capabilities: ["text-generation"] },
      { id: "editor", name: "Editor", capabilities: ["text-generation"] },
    ],
  };
}

function createTestContext(objective = "Create a technical blog post about TypeScript"): ExecutionContext {
  return {
    turnId: "smoke-turn-1",
    config: {
      schema_version: "1.0",
      agent: { id: "planner", name: "Planner", layer: "planning", version: "1.0.0" },
      model: { primary: "smoke-model", temperature: 0.1, max_output_tokens: 2048 },
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
      event_id: "smoke-evt-1",
      workflow_id: "smoke-wf-1",
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
    requestId: "smoke-req-1",
    objective: "Create a technical blog post about TypeScript",
    constraints: {
      maxCostUsd: 0.05,
      maxDurationSeconds: 120,
      requiredCapabilities: ["web-search", "text-generation"],
    },
    maxSteps: 5,
    preferredCapabilities: ["web-search", "text-generation"],
    ...overrides,
  };
}

describe("PlannerAgent Smoke Tests", () => {
  let agent: PlannerAgent;
  let context: ExecutionContext;

  beforeEach(() => {
    const deps = createSmokeDeps();
    agent = new PlannerAgent(deps);
    context = createTestContext();
  });

  it("should execute end-to-end and produce valid plan", async () => {
    const input: AgentExecutionInput = {
      context,
      input: createPlannerInput(),
    };

    const result = await agent.execute(input, createCancellationToken());

    ok(result);
    ok(result.output);
    ok(result.response);
  });

  it("should produce plan with correct objective", async () => {
    const testObjective = "Write a guide about React hooks";
    const testContext = createTestContext(testObjective);
    const input: AgentExecutionInput = {
      context: testContext,
      input: createPlannerInput({ objective: testObjective }),
    };

    const result = await agent.execute(input, createCancellationToken());
    const plan = result.output as ExecutionPlan;

    strictEqual(plan.objective, testObjective);
  });

  it("should produce plan with tasks array", async () => {
    const input: AgentExecutionInput = {
      context,
      input: createPlannerInput(),
    };

    const result = await agent.execute(input, createCancellationToken());
    const plan = result.output as ExecutionPlan;

    ok(Array.isArray(plan.tasks));
    ok(plan.tasks.length > 0);
  });

  it("should produce tasks with required fields", async () => {
    const input: AgentExecutionInput = {
      context,
      input: createPlannerInput(),
    };

    const result = await agent.execute(input, createCancellationToken());
    const plan = result.output as ExecutionPlan;

    for (const task of plan.tasks) {
      ok(task.id);
      ok(task.name);
      ok(task.description);
      ok(task.agent);
      ok(task.inputSchema);
      ok(task.outputSchema);
      ok(Array.isArray(task.dependencies));
      ok(typeof task.estimatedCostUsd === "number");
      ok(typeof task.estimatedDurationSeconds === "number");
      ok(typeof task.parallelizable === "boolean");
    }
  });

  it("should calculate estimated totals", async () => {
    const input: AgentExecutionInput = {
      context,
      input: createPlannerInput(),
    };

    const result = await agent.execute(input, createCancellationToken());
    const plan = result.output as ExecutionPlan;

    ok(plan.estimatedTotalCostUsd > 0);
    ok(plan.estimatedTotalDurationSeconds > 0);
    ok(typeof plan.hasParallelism === "boolean");
  });

  it("should include metadata", async () => {
    const input: AgentExecutionInput = {
      context,
      input: createPlannerInput(),
    };

    const result = await agent.execute(input, createCancellationToken());
    const plan = result.output as ExecutionPlan;

    ok(plan.metadata);
    ok(plan.metadata.createdAt);
    ok(plan.metadata.plannerVersion);
    ok(plan.metadata.taskCount === plan.tasks.length);
    ok(typeof plan.metadata.confidence === "number");
    ok(plan.metadata.confidence >= 0 && plan.metadata.confidence <= 1);
    ok(Array.isArray(plan.metadata.warnings));
  });

  it("should respect constraints in planning", async () => {
    const input: AgentExecutionInput = {
      context,
      input: createPlannerInput({
        constraints: {
          maxCostUsd: 0.01,
          maxDurationSeconds: 60,
          requiredCapabilities: ["web-search"],
        },
      }),
    };

    const result = await agent.execute(input, createCancellationToken());
    const plan = result.output as ExecutionPlan;

    ok(plan.estimatedTotalCostUsd <= 0.05); // Should respect max cost constraint
    ok(plan.estimatedTotalDurationSeconds <= 120);
  });

  it("should use available agents for task assignment", async () => {
    const input: AgentExecutionInput = {
      context,
      input: createPlannerInput(),
    };

    const result = await agent.execute(input, createCancellationToken());
    const plan = result.output as ExecutionPlan;

    const usedAgents = new Set(plan.tasks.map(t => t.agent));
    ok(usedAgents.has("research") || usedAgents.has("writer") || usedAgents.has("editor"));
  });

  it("should handle factory function", async () => {
    const factoryAgent = createPlannerAgent({
      execute: createSmokeDeps().execute,
      config: { model: "factory-model" },
    });

    const input: AgentExecutionInput = {
      context,
      input: createPlannerInput(),
    };

    const result = await factoryAgent.execute(input, createCancellationToken());
    ok(result);
    strictEqual(factoryAgent.id, "planner");
  });

  it("should return proper response metadata", async () => {
    const input: AgentExecutionInput = {
      context,
      input: createPlannerInput(),
    };

    const result = await agent.execute(input, createCancellationToken());

    ok(result.response);
    strictEqual(result.response.model, "smoke-model");
    strictEqual(result.response.provider, "planner");
    ok(typeof result.response.latencyMs === "number");
    ok(result.response.usage);
  });

  it("should handle different objectives", async () => {
    const objectives = [
      "Create a marketing campaign",
      "Analyze competitor data",
      "Write documentation for API",
      "Design a database schema",
    ];

    for (const obj of objectives) {
      const testContext = createTestContext(obj);
      const input: AgentExecutionInput = {
        context: testContext,
        input: createPlannerInput({ objective: obj }),
      };

      const result = await agent.execute(input, createCancellationToken());
      const plan = result.output as ExecutionPlan;
      strictEqual(plan.objective, obj);
    }
  });

  it("should handle cancellation token", async () => {
    const input: AgentExecutionInput = {
      context,
      input: createPlannerInput(),
    };

    const cancelledToken = createCancellationToken(true);

    await rejects(
      () => agent.execute(input, cancelledToken),
      /Cancelled/
    );
  });
});