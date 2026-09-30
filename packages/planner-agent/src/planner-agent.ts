/**
 * Planner Agent implementation.
 * Extends BaseAgent to produce structured execution plans from high-level objectives.
 */

import { randomUUID } from "node:crypto";
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
  PlannerStage,
  InitialContentPlan,
  EvidenceBackedContentBrief,
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

/**
 * A safe structural carrier shared with the governed executor.  It contains
 * only schema shape/type information, never model text or prompt evidence.
 */
export type StructuredOutputDiagnostics = {
  readonly validationKind: "STRUCTURAL";
  readonly contract: "POST_RESEARCH_SYNTHESIS";
  readonly issues: readonly { readonly path: string; readonly code: string; readonly expected?: string; readonly actualType?: string }[];
  readonly shape: { readonly topLevelKeys: readonly string[]; readonly nestedKeys: Readonly<Record<string, readonly string[]>>; readonly truncated: boolean };
  readonly diagnosticsTruncated: boolean;
};

export class StructuredOutputValidationError extends Error {
  constructor(readonly diagnostics: StructuredOutputDiagnostics) {
    super("Invalid strategy planner synthesis response");
  }
}

type JsonObject = Record<string, unknown>;
const object = (value: unknown): value is JsonObject => value !== null && typeof value === "object" && !Array.isArray(value);
const kind = (value: unknown): string => value === undefined ? "missing" : Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
const keys = (value: unknown): { keys: string[]; truncated: boolean } => !object(value) ? { keys: [], truncated: false } : (() => { const all = Object.keys(value).sort(); return { keys: all.slice(0, 20), truncated: all.length > 20 }; })();
export const PLANNER_SYNTHESIS_STRING_FIELDS = ["briefId", "objective", "finalAngle", "hookDirection", "audienceFraming"] as const;
export const PLANNER_SYNTHESIS_ARRAY_FIELDS = ["keyPoints", "claims", "uncertainties", "evidenceRefs", "messageProgression", "toneConstraints", "writerInstructions", "originalityConstraints", "platformConstraints", "researchSources", "warnings"] as const;
export function plannerSynthesisContractInstructions(): string {
  return `Produce ONLY JSON with required string fields ${PLANNER_SYNTHESIS_STRING_FIELDS.join(", ")}; required array fields ${PLANNER_SYNTHESIS_ARRAY_FIELDS.join(", ")}; and status exactly "completed" or "blocked". objective must exactly equal the supplied initial plan objective.`;
}

/** Diagnose only the current accepted planner contract; this does not widen it. */
export function diagnosePlannerSynthesisStructure(output: unknown, initialPlan: InitialContentPlan): StructuredOutputDiagnostics {
  const issues: { path: string; code: string; expected?: string; actualType?: string }[] = [];
  const add = (issue: { path: string; code: string; expected?: string; actualType?: string }) => { if (issues.length < 20) issues.push({ ...issue, path: issue.path.slice(0, 160) }); };
  const root = object(output) ? output : undefined;
  const rootKeys = keys(output);
  if (!root) add({ path: "$", code: "wrong_type", expected: "object", actualType: kind(output) });
  const strings = PLANNER_SYNTHESIS_STRING_FIELDS;
  const arrays = PLANNER_SYNTHESIS_ARRAY_FIELDS;
  for (const field of strings) {
    const value = root?.[field];
    if (value === undefined) add({ path: field, code: "missing_required", expected: "string" });
    else if (typeof value !== "string") add({ path: field, code: "wrong_type", expected: "string", actualType: kind(value) });
  }
  for (const field of arrays) {
    const value = root?.[field];
    if (value === undefined) add({ path: field, code: "missing_required", expected: "array" });
    else if (!Array.isArray(value)) add({ path: field, code: "wrong_type", expected: "array", actualType: kind(value) });
  }
  const status = root?.status;
  if (status === undefined) add({ path: "status", code: "missing_required", expected: "completed|blocked" });
  else if (status !== "completed" && status !== "blocked") add({ path: "status", code: "invalid_enum", expected: "completed|blocked", actualType: kind(status) });
  if (typeof root?.objective === "string" && root.objective !== initialPlan.objective) add({ path: "objective", code: "value_mismatch", expected: "exact initialPlan.objective" });
  const nested = { claims: keys(root?.claims), researchSources: keys(root?.researchSources) };
  return { validationKind: "STRUCTURAL", contract: "POST_RESEARCH_SYNTHESIS", issues, shape: { topLevelKeys: rootKeys.keys, nestedKeys: { claims: nested.claims.keys, researchSources: nested.researchSources.keys }, truncated: rootKeys.truncated || nested.claims.truncated || nested.researchSources.truncated }, diagnosticsTruncated: issues.length >= 20 };
}

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
    const strategyMode = (plannerInput as unknown as { strategyMode?: unknown }).strategyMode === "PRE_PUBLICATION_STRATEGY";
    if (strategyMode && plannerInput.stage === "INITIAL_CONTENT_PLAN") {
      return this.createStrategyInitialContentPlan(plannerInput, input.context, signal);
    }
    if (strategyMode && plannerInput.stage === "POST_RESEARCH_SYNTHESIS") {
      return this.createStrategyEvidenceBrief(plannerInput, input.context, signal);
    }
    const plan = plannerInput.stage === "INITIAL_CONTENT_PLAN"
      ? this.createInitialContentPlan(plannerInput)
      : plannerInput.stage === "POST_RESEARCH_SYNTHESIS"
        ? this.createPostResearchSynthesis(plannerInput)
        : await this.createPlan(plannerInput, input.context, signal);

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

  private createInitialContentPlan(input: PlannerInput): InitialContentPlan {
    if (!input.objective?.trim()) throw new Error("Initial content plan requires an objective");
    return {
      planId: input.requestId || randomUUID(), tasks: [], stage: "INITIAL_CONTENT_PLAN", objective: input.objective,
      topic: input.topic ?? input.objective, audience: input.audience ?? "general social audience",
      platform: input.platform ?? "unspecified", toneConstraints: input.toneConstraints ?? [],
      researchQuestions: input.researchQuestions ?? [input.objective],
      researchObjectives: input.researchObjectives ?? ["Collect source-backed context for the objective."],
      knownRestrictions: input.knownRestrictions ?? [], desiredDeliverables: input.desiredDeliverables ?? ["script"],
      factualClaims: [],
    };
  }

  /**
   * Strategy council plans must be actual LLM reasoning. The legacy stage
   * helpers above remain deterministic for ordinary production workflows, but
   * cannot be used as a substitute for a council specialist response.
   */
  private async createStrategyInitialContentPlan(input: PlannerInput, context: ExecutionContext, signal: CancellationToken): Promise<AgentExecutionOutput> {
    const prompt = `${this.plannerConfig.systemPrompt}\n\nPRE_PUBLICATION_STRATEGY initial plan. Return compact JSON only. The only LLM-authored strategic content required is a non-empty tasks array; each task must have id, name, description, agent, inputSchema, outputSchema, dependencies, estimatedCostUsd, estimatedDurationSeconds, and parallelizable. Do not make market claims without later research evidence. Objective: ${input.objective}`;
    const response = await this.runExecution(context, this.buildExecutionRequest(prompt), signal);
    const value = response.output as unknown as Record<string, unknown>;
    if (!Array.isArray(value.tasks) || value.tasks.length === 0) throw new Error("Invalid strategy planner response: missing substantive LLM tasks");
    for (const task of value.tasks) {
      const item = task as Record<string, unknown>;
      if (item === null || typeof item !== "object" || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.description !== "string" || item.description.trim().length < 20 || typeof item.agent !== "string") {
        throw new Error("Invalid strategy planner response: malformed substantive LLM task");
      }
    }
    const plan: InitialContentPlan = {
      // This wrapper is lifecycle metadata. The tasks remain the unmodified
      // LLM-authored strategy, which is the substantive plan.
      planId: typeof value.planId === "string" ? value.planId : input.requestId || randomUUID(), stage: "INITIAL_CONTENT_PLAN", objective: input.objective, topic: input.topic ?? input.objective, audience: input.audience ?? "general social audience", platform: input.platform ?? "unspecified",
      toneConstraints: input.toneConstraints ?? [], researchQuestions: input.researchQuestions ?? [input.objective], researchObjectives: input.researchObjectives ?? ["Collect source-backed context for the objective."], knownRestrictions: input.knownRestrictions ?? [], desiredDeliverables: input.desiredDeliverables ?? ["script"], factualClaims: Array.isArray(value.factualClaims) ? value.factualClaims as InitialContentPlan["factualClaims"] : [],
      tasks: value.tasks as InitialContentPlan["tasks"],
    };
    const output = plan as unknown as Json;
    return { output, response: { ...response, output, raw: JSON.stringify(plan, null, 2) } };
  }

  private async createStrategyEvidenceBrief(input: PlannerInput, context: ExecutionContext, signal: CancellationToken): Promise<AgentExecutionOutput> {
    if (!input.initialPlan || !input.researchResult) throw new Error("Strategy planner synthesis requires initial plan and research result");
    const prompt = `${this.plannerConfig.systemPrompt}\n\nPRE_PUBLICATION_STRATEGY evidence synthesis. Use ONLY this initial plan and research result. ${plannerSynthesisContractInstructions()} Every claim must cite supplied source ids; do not manufacture sources.\nInitial plan: ${JSON.stringify(input.initialPlan)}\nResearch result: ${JSON.stringify(input.researchResult)}`;
    const response = await this.runExecution(context, this.buildExecutionRequest(prompt), signal);
    const value = response.output as unknown as Record<string, unknown>;
    const diagnostics = diagnosePlannerSynthesisStructure(value, input.initialPlan);
    if (diagnostics.issues.length > 0) throw new StructuredOutputValidationError(diagnostics);
    const arrays = PLANNER_SYNTHESIS_ARRAY_FIELDS;
    if (typeof value.briefId !== "string" || typeof value.objective !== "string" || typeof value.finalAngle !== "string" || typeof value.hookDirection !== "string" || typeof value.audienceFraming !== "string" || (value.status !== "completed" && value.status !== "blocked") || arrays.some((key) => !Array.isArray(value[key]))) throw new StructuredOutputValidationError(diagnostics);
    if (value.objective !== input.initialPlan.objective) throw new StructuredOutputValidationError(diagnostics);
    const brief = { ...value, stage: "POST_RESEARCH_SYNTHESIS" } as unknown as EvidenceBackedContentBrief;
    const output = brief as unknown as Json;
    return { output, response: { ...response, output, raw: JSON.stringify(brief, null, 2) } };
  }

  private createPostResearchSynthesis(input: PlannerInput): EvidenceBackedContentBrief {
    const plan = input.initialPlan;
    const result = input.researchResult;
    if (!plan || plan.stage !== "INITIAL_CONTENT_PLAN") throw new Error("Post-research synthesis requires the initial content plan");
    if (!result || typeof result.summary !== "string" || !Array.isArray(result.sources)) throw new Error("Post-research synthesis requires a valid ResearchResult");
    const sources = result.sources.filter((source) => source && typeof source.id === "number" && typeof source.title === "string" && typeof source.url === "string");
    const warnings = [...(result.unknowns ?? [])];
    if (sources.length === 0) warnings.push("No usable research sources were available; factual claims are blocked.");
    const claims: EvidenceBackedContentBrief["claims"] = sources.map((source) => ({
      text: source.snippet?.trim() || source.title,
      status: source.snippet?.trim() ? "SUPPORTED" : "UNCERTAIN",
      sourceIds: [source.id],
      rationale: source.snippet?.trim() ? "Directly supported by normalized research evidence." : "Source identity exists but no supporting excerpt was supplied.",
    }));
    if (sources.length === 0) claims.push({ text: "No factual claim is authorized without evidence.", status: "UNSUPPORTED", sourceIds: [], rationale: "Fail-closed claim governance." });
    return {
      briefId: randomUUID(), stage: "POST_RESEARCH_SYNTHESIS", objective: plan.objective,
      finalAngle: plan.topic, keyPoints: claims.filter((claim) => claim.status === "SUPPORTED").map((claim) => claim.text),
      claims, uncertainties: [...(result.unknowns ?? []), ...sources.filter((source) => !source.snippet?.trim()).map((source) => `Evidence excerpt unavailable for source ${source.id}.`)],
      evidenceRefs: sources.map((source) => source.id), hookDirection: `Introduce ${plan.topic} through a concise evidence-backed hook.`,
      messageProgression: ["Hook", "Evidence-backed points", "Clear close"], audienceFraming: plan.audience,
      toneConstraints: plan.toneConstraints, writerInstructions: ["Write the script only from SUPPORTED claims; omit UNSUPPORTED and label or avoid UNCERTAIN claims."],
      originalityConstraints: ["Use research as evidence and structural inspiration; do not reproduce source phrasing."], platformConstraints: plan.platform === "unspecified" ? [] : [plan.platform],
      researchSources: sources.map((source) => ({ sourceId: source.id, title: source.title, url: source.url, ...(source.snippet === undefined ? {} : { snippet: source.snippet }) })),
      warnings, status: sources.length > 0 ? "completed" : "blocked",
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
    const response = await this.runExecution(context, request, signal);

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
