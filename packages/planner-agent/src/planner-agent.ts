/**
 * Planner Agent implementation.
 * Extends BaseAgent to produce structured execution plans from high-level objectives.
 */

import type { AgentId, Json, Uuid } from "@ai-media-factory/runtime";
import type { ExecutionContext, ExecutionResponse, CancellationToken } from "@ai-media-factory/runtime";
import { BaseAgent, type BaseAgentDependencies, type AgentExecutionInput, type AgentExecutionOutput } from "@ai-media-factory/runtime";
import type { ExecutionRequest } from "@ai-media-factory/runtime";
import type {
  PlannerInput,
  PlannerConfig,
  ExecutionPlan,
  PlanTask,
  PlanMetadata,
  AgentCapability,
} from "./planner-types.js";

/** Planner Agent dependencies. */
export interface PlannerAgentDependencies extends BaseAgentDependencies {
  config: PlannerConfig;
  availableAgents?: AgentCapability[];
}

/** Default planner system prompt. */
export const DEFAULT_PLANNER_SYSTEM_PROMPT = `You are an expert AI planner. Your job is to analyze high-level objectives and produce detailed, executable plans.

Given an objective and constraints, you must:
1. Break the objective into ordered, atomic tasks
2. Identify dependencies between tasks
3. Assign appropriate agents/capabilities to each task
4. Estimate costs and durations
5. Identify parallelization opportunities
6. Output a structured JSON plan

Your output must be valid JSON conforming to the ExecutionPlan schema.
Do not include any explanatory text outside the JSON.`;

export class PlannerAgent extends BaseAgent {
  readonly id: AgentId = "planner";
  readonly name = "Planner Agent";
  readonly version = "1.0.0";

  private readonly plannerConfig: PlannerConfig;
  private readonly availableAgents: AgentCapability[];

  constructor(deps: PlannerAgentDependencies) {
    super(deps);
    this.plannerConfig = deps.config;
    this.availableAgents = deps.availableAgents ?? [];
  }

  async execute(input: AgentExecutionInput, signal: CancellationToken): Promise<AgentExecutionOutput> {
    // Extract planner input from the generic agent input
    const plannerInput = input.input as unknown as PlannerInput;
    const plan = await this.createPlan(plannerInput, input.context, signal);

    // Convert plan to ExecutionResponse format
    const response: ExecutionResponse = {
      output: plan as unknown as Json,
      raw: JSON.stringify(plan, null, 2),
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
      },
      model: this.plannerConfig.model,
      provider: "planner",
      latencyMs: 0,
    };

    return {
      output: plan as unknown as Json,
      response,
    };
  }

  private async createPlan(
    input: PlannerInput,
    context: ExecutionContext,
    signal: CancellationToken
  ): Promise<ExecutionPlan> {
    signal?.throwIfCancelled();

    // Build the planning prompt
    const prompt = this.buildPlanningPrompt(input);

    // Execute via the runtime (which calls the LLM)
    const request = this.buildExecutionRequest(prompt);
    const response = await this.runExecution(context, signal);

    // Parse and validate the response
    const plan = this.parsePlanResponse(response.output as Json, input);

    return plan;
  }

  private buildPlanningPrompt(input: PlannerInput): string {
    const agentsInfo = this.availableAgents.length > 0
      ? `\nAvailable agents:\n${this.availableAgents.map(a => `- ${a.id} (${a.name}): ${a.capabilities.join(", ")}`).join("\n")}`
      : "";

    const constraintsInfo = input.constraints ? `
Constraints:
- Max cost: ${input.constraints.maxCostUsd ?? "unlimited"} USD
- Max duration: ${input.constraints.maxDurationSeconds ?? "unlimited"} seconds
- Required capabilities: ${input.constraints.requiredCapabilities?.join(", ") ?? "none"}
- Forbidden capabilities: ${input.constraints.forbiddenCapabilities?.join(", ") ?? "none"}
- Deterministic: ${input.constraints.deterministic ?? false}
- Max parallelism: ${input.constraints.maxParallelism ?? "unlimited"}
` : "";

    const contextInfo = input.context ? `
Context:
- Previous plan: ${input.context.previousPlan ? "yes (revision)" : "no"}
- Memory refs: ${input.context.memoryRefs?.join(", ") ?? "none"}
` : "";

    return `${this.plannerConfig.systemPrompt}

Objective: ${input.objective}
${constraintsInfo}
${contextInfo}
${agentsInfo}

Max steps: ${input.maxSteps ?? 10}
Preferred capabilities: ${input.preferredCapabilities?.join(", ") ?? "any"}

Output a valid ExecutionPlan JSON with:
- planId (UUID)
- objective (string)
- tasks (array of PlanTask)
- estimatedTotalCostUsd (number)
- estimatedTotalDurationSeconds (number)
- hasParallelism (boolean)
- metadata (PlanMetadata with createdAt, plannerVersion, taskCount, parallelGroupCount, confidence, warnings)

Each PlanTask must have:
- id (StepId)
- name (string)
- description (string)
- agent (string - agent id from available agents)
- inputSchema (JSON schema)
- outputSchema (JSON schema)
- dependencies (array of StepId)
- estimatedCostUsd (number)
- estimatedDurationSeconds (number)
- parallelizable (boolean)
- retryPolicy (optional)`;
  }

  private buildExecutionRequest(prompt: string): ExecutionRequest {
    return {
      model: this.plannerConfig.model,
      system: this.plannerConfig.systemPrompt,
      messages: [
        { role: "system", content: this.plannerConfig.systemPrompt },
        { role: "user", content: prompt },
      ],
      temperature: this.plannerConfig.temperature,
      maxOutputTokens: this.plannerConfig.maxOutputTokens,
      responseSchema: this.getPlanResponseSchema(),
    };
  }

  private getPlanResponseSchema(): import("@ai-media-factory/runtime").JsonSchema {
    return {
      type: "object",
      properties: {
        planId: { type: "string", format: "uuid" },
        objective: { type: "string" },
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              description: { type: "string" },
              agent: { type: "string" },
              inputSchema: { type: "object" },
              outputSchema: { type: "object" },
              dependencies: { type: "array", items: { type: "string" } },
              estimatedCostUsd: { type: "number" },
              estimatedDurationSeconds: { type: "number" },
              parallelizable: { type: "boolean" },
              retryPolicy: {
                type: "object",
                properties: {
                  maxAttempts: { type: "number" },
                  backoffMs: { type: "number" },
                },
              },
            },
            required: ["id", "name", "description", "agent", "inputSchema", "outputSchema", "dependencies"],
          },
        },
        estimatedTotalCostUsd: { type: "number" },
        estimatedTotalDurationSeconds: { type: "number" },
        hasParallelism: { type: "boolean" },
        metadata: {
          type: "object",
          properties: {
            createdAt: { type: "string" },
            plannerVersion: { type: "string" },
            taskCount: { type: "number" },
            parallelGroupCount: { type: "number" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            warnings: { type: "array", items: { type: "string" } },
          },
          required: ["createdAt", "plannerVersion", "taskCount", "parallelGroupCount", "confidence", "warnings"],
        },
      },
      required: ["planId", "objective", "tasks", "estimatedTotalCostUsd", "estimatedTotalDurationSeconds", "hasParallelism", "metadata"],
    };
  }

  private parsePlanResponse(output: Json, input: PlannerInput): ExecutionPlan {
    const plan = output as unknown as ExecutionPlan;

    // Validate required fields
    if (!plan.planId || !plan.objective || !Array.isArray(plan.tasks)) {
      throw new Error("Invalid plan response: missing required fields");
    }

    // Ensure metadata is complete
    const now = new Date().toISOString();
    plan.metadata = {
      createdAt: plan.metadata?.createdAt ?? now,
      plannerVersion: plan.metadata?.plannerVersion ?? this.version,
      taskCount: plan.tasks.length,
      parallelGroupCount: plan.metadata?.parallelGroupCount ?? this.countParallelGroups(plan.tasks),
      confidence: plan.metadata?.confidence ?? 0.8,
      warnings: plan.metadata?.warnings ?? [],
    };

    // Calculate totals if not provided (null/undefined, not 0)
    if (plan.estimatedTotalCostUsd == null) {
      plan.estimatedTotalCostUsd = plan.tasks.reduce((sum, t) => sum + (t.estimatedCostUsd ?? 0), 0);
    }
    if (plan.estimatedTotalDurationSeconds == null) {
      plan.estimatedTotalDurationSeconds = this.calculateTotalDuration(plan.tasks);
    }
    if (plan.hasParallelism == null) {
      plan.hasParallelism = plan.tasks.some(t => t.parallelizable);
    }

    return plan;
  }

  private countParallelGroups(tasks: PlanTask[]): number {
    const parallelizable = tasks.filter(t => t.parallelizable);
    if (parallelizable.length === 0) return 0;

    const levels = new Map<string, number>();
    const visited = new Set<string>();

    const getLevel = (taskId: string): number => {
      if (visited.has(taskId)) return levels.get(taskId) ?? 0;
      visited.add(taskId);

      const task = tasks.find(t => t.id === taskId);
      if (!task || task.dependencies.length === 0) {
        levels.set(taskId, 0);
        return 0;
      }

      const maxDepLevel = Math.max(...task.dependencies.map(getLevel));
      const level = maxDepLevel + 1;
      levels.set(taskId, level);
      return level;
    };

    tasks.forEach(t => getLevel(t.id));
    const maxLevel = Math.max(...levels.values());
    return maxLevel + 1;
  }

  private calculateTotalDuration(tasks: PlanTask[]): number {
    const durationById = new Map<string, number>();
    const visited = new Set<string>();

    const getDuration = (taskId: string): number => {
      if (visited.has(taskId)) return durationById.get(taskId) ?? 0;
      visited.add(taskId);

      const task = tasks.find(t => t.id === taskId);
      if (!task) return 0;

      const depDurations = task.dependencies.map(getDuration);
      const maxDepDuration = depDurations.length > 0 ? Math.max(...depDurations) : 0;
      const duration = maxDepDuration + (task.estimatedDurationSeconds ?? 60);
      durationById.set(taskId, duration);
      return duration;
    };

    return Math.max(...tasks.map(t => getDuration(t.id)));
  }
}

/** Factory function to create a PlannerAgent with default config. */
export function createPlannerAgent(deps: PlannerAgentDependencies): PlannerAgent {
  const defaultConfig: PlannerConfig = {
    ...deps.config,
    model: deps.config?.model ?? "openrouter/auto",
    temperature: deps.config?.temperature ?? 0.2,
    maxOutputTokens: deps.config?.maxOutputTokens ?? 4096,
    systemPrompt: deps.config?.systemPrompt ?? DEFAULT_PLANNER_SYSTEM_PROMPT,
    includeReasoning: deps.config?.includeReasoning ?? false,
  };

  return new PlannerAgent({ ...deps, config: defaultConfig });
}