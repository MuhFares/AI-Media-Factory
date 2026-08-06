/**
 * Planner Agent interfaces and models.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Json, Uuid } from "@ai-media-factory/runtime";
import type { Step, AgentStep, BranchStep, ParallelStep, GateStep, CompensationStep, StepId } from "@ai-media-factory/workflow-engine";

/** Input to the planner: a high-level objective. */
export interface PlannerInput {
  /** Unique request identifier. */
  requestId: Uuid;
  /** The high-level objective in natural language. */
  objective: string;
  /** Optional constraints for the plan. */
  constraints?: PlannerConstraints;
  /** Optional context from previous interactions. */
  context?: PlannerContext;
  /** Maximum number of steps in the plan. */
  maxSteps?: number;
  /** Preferred agent capabilities to use. */
  preferredCapabilities?: string[];
}

/** Constraints that guide the planning process. */
export interface PlannerConstraints {
  /** Maximum estimated cost in USD. */
  maxCostUsd?: number;
  /** Maximum estimated duration in seconds. */
  maxDurationSeconds?: number;
  /** Required capabilities that must be available. */
  requiredCapabilities?: string[];
  /** Forbidden capabilities that must not be used. */
  forbiddenCapabilities?: string[];
  /** Whether the plan must be deterministic. */
  deterministic?: boolean;
  /** Maximum parallelism (for parallel steps). */
  maxParallelism?: number;
}

/** Context for the planner from previous runs or external sources. */
export interface PlannerContext {
  /** Previous plan if this is a revision. */
  previousPlan?: ExecutionPlan;
  /** Available agents and their capabilities. */
  availableAgents?: AgentCapability[];
  /** Memory references for context. */
  memoryRefs?: string[];
  /** External data sources. */
  externalData?: Record<string, Json>;
}

/** Describes an agent capability for planning purposes. */
export interface AgentCapability {
  id: string;
  name: string;
  capabilities: string[];
  estimatedCostPerCall?: number;
  estimatedLatencyMs?: number;
}

/** A single task in the execution plan. */
export interface PlanTask {
  /** Unique task identifier. */
  id: StepId;
  /** Human-readable task name. */
  name: string;
  /** Description of what this task does. */
  description: string;
  /** The agent or capability required. */
  agent: string;
  /** Input schema for this task. */
  inputSchema: Json;
  /** Expected output schema. */
  outputSchema: Json;
  /** Dependencies on other tasks (by task id). */
  dependencies: StepId[];
  /** Estimated cost in USD. */
  estimatedCostUsd?: number;
  /** Estimated duration in seconds. */
  estimatedDurationSeconds?: number;
  /** Whether this task can run in parallel with others. */
  parallelizable?: boolean;
  /** Retry policy override. */
  retryPolicy?: {
    maxAttempts?: number;
    backoffMs?: number;
  };
}

/** The complete execution plan output by the planner. */
export interface ExecutionPlan {
  /** Unique plan identifier. */
  planId: Uuid;
  /** The original objective. */
  objective: string;
  /** Ordered list of tasks to execute. */
  tasks: PlanTask[];
  /** Estimated total cost. */
  estimatedTotalCostUsd: number;
  /** Estimated total duration in seconds. */
  estimatedTotalDurationSeconds: number;
  /** Whether the plan uses parallel execution. */
  hasParallelism: boolean;
  /** Plan metadata. */
  metadata: PlanMetadata;
}

/** Metadata about the generated plan. */
export interface PlanMetadata {
  /** When the plan was created. */
  createdAt: string;
  /** Planner version that generated this plan. */
  plannerVersion: string;
  /** Number of tasks. */
  taskCount: number;
  /** Number of parallel groups. */
  parallelGroupCount: number;
  /** Confidence score (0-1). */
  confidence: number;
  /** Warnings or notes about the plan. */
  warnings: string[];
}

/** Planner agent configuration. */
export interface PlannerConfig {
  /** Model to use for planning. */
  model: string;
  /** Temperature for planning (lower = more deterministic). */
  temperature: number;
  /** Maximum tokens for planning output. */
  maxOutputTokens: number;
  /** System prompt for the planner. */
  systemPrompt: string;
  /** Whether to include chain-of-thought in output. */
  includeReasoning?: boolean;
}

/** Planner execution input (extends base agent input). */
export interface PlannerExecutionInput {
  context: import("@ai-media-factory/runtime").ExecutionContext;
  input: PlannerInput;
}

/** Planner execution output (extends base agent output). */
export interface PlannerExecutionOutput {
  output: ExecutionPlan;
  response: import("@ai-media-factory/runtime").ExecutionResponse;
}