/**
 * Evaluation Metrics and Scorecards.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Timestamp, Json } from "./common";

/** Individual metric definition. */
export interface MetricDefinition {
  /** Unique metric identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Description of what this metric measures. */
  description: string;
  /** Unit of measurement. */
  unit: string;
  /** Higher is better (true) or lower is better (false). */
  higherIsBetter: boolean;
  /** Normalization function to convert raw value to 0-1 score. */
  normalization: NormalizationFunction;
  /** Category for grouping. */
  category: string;
  /** Tags for filtering. */
  tags: string[];
}

/** Function to normalize raw value to 0-1 score. */
export type NormalizationFunction =
  | { type: "linear"; min: number; max: number }
  | { type: "logarithmic"; base: number }
  | { type: "step"; thresholds: number[] }
  | { type: "custom"; functionName: string };

/** Scorecard for an evaluated entity. */
export interface Scorecard {
  /** Entity being scored. */
  entityType: string;
  entityId: string;
  /** Overall score (0-1). */
  overallScore: number;
  /** Individual metric scores. */
  metrics: MetricScore[];
  /** Weighted category scores. */
  categoryScores: CategoryScore[];
  /** Quality gate results. */
  gateResults: GateResult[];
  /** Generated timestamp. */
  generatedAt: string;
  /** Evaluation run ID. */
  evaluationId: string;
}

export interface MetricScore {
  metricId: string;
  metricName: string;
  rawValue: number;
  normalizedScore: number;     // 0-1 normalized
  weight: number;
  passed: boolean;
  threshold: number;
  actualValue: number;
}

export interface CategoryScore {
  category: string;
  score: number;               // 0-1 weighted average
  weight: number;
  metrics: MetricScore[];
  passed: boolean;
}

export interface GateResult {
  gateId: string;
  gateName: string;
  decision: "pass" | "warn" | "fail" | "block";
  score: number;
  threshold: number;
  message: string;
}

/** Predefined metric registry for the platform. */
export const STANDARD_METRICS: Record<string, MetricDefinition> = {
  // Agent metrics
  "agent.task_success_rate": {
    id: "agent.task_success_rate",
    name: "Task Success Rate",
    description: "Percentage of agent tasks completed successfully",
    description: "Percentage of agent tasks completed successfully",
    unit: "percentage",
    higherIsBetter: true,
    normalization: { type: "linear", min: 0, max: 100 },
    category: "agent",
    tags: ["reliability", "quality"]
  },
  "agent.avg_latency_ms": {
    id: "agent.avg_latency_ms",
    name: "Average Latency",
    description: "Average time to complete a task",
    unit: "milliseconds",
    higherIsBetter: false,
    normalization: { type: "linear", min: 0, max: 300000 },
    category: "agent",
    tags: ["performance", "latency"]
  },
  "agent.autonomy_rate": {
    id: "agent.autonomy_rate",
    name: "Autonomy Rate",
    description: "Percentage of steps completed without human intervention",
    unit: "percentage",
    higherIsBetter: true,
    normalization: { type: "linear", min: 0, max: 100 },
    category: "agent",
    tags: ["autonomy", "efficiency"]
  },
  "agent.retry_rate": {
    id: "agent.retry_rate",
    name: "Retry Rate",
    description: "Percentage of tasks requiring retries",
    unit: "percentage",
    higherIsBetter: false,
    normalization: { type: "linear", min: 0, max: 50 },
    category: "agent",
    tags: ["reliability", "stability"]
  },

  // Provider metrics
  "provider.availability": {
    id: "provider.availability",
    name: "Provider Availability",
    description: "Uptime percentage of the provider",
    unit: "percentage",
    higherIsBetter: true,
    normalization: { type: "linear", min: 99, max: 100 },
    category: "provider",
    tags: ["reliability", "uptime"]
  },
  "provider.latency_p95": {
    id: "provider.latency_p95",
    name: "Provider P95 Latency",
    description: "95th percentile latency",
    unit: "milliseconds",
    higherIsBetter: false,
    normalization: { type: "linear", min: 0, max: 10000 },
    category: "provider",
    tags: ["performance", "latency"]
  },
  "provider.error_rate": {
    id: "provider.error_rate",
    name: "Provider Error Rate",
    description: "Percentage of failed requests",
    unit: "percentage",
    higherIsBetter: false,
    normalization: { type: "linear", min: 0, max: 5 },
    category: "provider",
    tags: ["reliability", "errors"]
  },
  "provider.cost_per_1k_tokens": {
    id: "provider.cost_per_1k_tokens",
    name: "Cost per 1K Tokens",
    description: "Average cost per 1000 tokens",
    unit: "USD",
    higherIsBetter: false,
    normalization: { type: "linear", min: 0, max: 10 },
    category: "provider",
    tags: ["cost", "efficiency"]
  },

  // Workflow metrics
  "workflow.success_rate": {
    id: "workflow.success_rate",
    name: "Workflow Success Rate",
    description: "Percentage of workflows completing successfully",
    unit: "percentage",
    higherIsBetter: true,
    normalization: { type: "linear", min: 0, max: 100 },
    category: "workflow",
    tags: ["reliability", "completion"]
  },
  "workflow.avg_duration_ms": {
    id: "workflow.avg_duration_ms",
    name: "Average Workflow Duration",
    description: "Average time to complete a workflow",
    unit: "milliseconds",
    higherIsBetter: false,
    normalization: { type: "linear", min: 0, max: 3600000 },
    category: "workflow",
    tags: ["performance", "speed"]
  },
  "workflow.rework_rate": {
    id: "workflow.rework_rate",
    name: "Rework Rate",
    description: "Percentage of workflows requiring rework",
    unit: "percentage",
    higherIsBetter: false,
    normalization: { type: "linear", min: 0, max: 50 },
    category: "workflow",
    tags: ["quality", "efficiency"]
  },
  "workflow.autonomy_rate": {
    id: "workflow.autonomy_rate",
    name: "Workflow Autonomy Rate",
    description: "Percentage of workflow steps completed autonomously",
    unit: "percentage",
    higherIsBetter: true,
    normalization: { type: "linear", min: 0, max: 100 },
    category: "workflow",
    tags: ["autonomy", "efficiency"]
  },

  // Prompt metrics
  "prompt.token_efficiency": {
    id: "prompt.token_efficiency",
    name: "Token Efficiency",
    description: "Output quality per token used",
    unit: "score_per_token",
    higherIsBetter: true,
    normalization: { type: "linear", min: 0, max: 100 },
    category: "prompt",
    tags: ["efficiency", "cost"]
  },
  "prompt.schema_compliance": {
    id: "prompt.schema_compliance",
    name: "Schema Compliance Rate",
    description: "Percentage of outputs matching schema",
    unit: "percentage",
    higherIsBetter: true,
    normalization: { type: "linear", min: 0, max: 100 },
    category: "prompt",
    tags: ["quality", "compliance"]
  },

  // Memory metrics
  "memory.retrieval_precision": {
    id: "memory.retrieval_precision",
    name: "Memory Retrieval Precision",
    description: "Precision of retrieved memories",
    unit: "percentage",
    higherIsBetter: true,
    normalization: { type: "linear", min: 0, max: 100 },
    category: "memory",
    tags: ["accuracy", "retrieval"]
  },
  "memory.retrieval_recall": {
    id: "memory.retrieval_recall",
    name: "Memory Retrieval Recall",
    description: "Recall of relevant memories",
    unit: "percentage",
    higherIsBetter: true,
    normalization: { type: "linear", min: 0, max: 100 },
    category: "memory",
    tags: ["completeness", "retrieval"]
  },
  "memory.conflict_rate": {
    id: "memory.conflict_rate",
    name: "Memory Conflict Rate",
    description: "Rate of conflicting memories detected",
    unit: "percentage",
    higherIsBetter: false,
    normalization: { type: "linear", min: 0, max: 10 },
    category: "memory",
    tags: ["consistency", "quality"]
  },

  // Tool metrics
  "tool.success_rate": {
    id: "tool.success_rate",
    name: "Tool Success Rate",
    description: "Percentage of successful tool invocations",
    unit: "percentage",
    higherIsBetter: true,
    normalization: { type: "linear", min: 0, max: 100 },
    category: "tool",
    tags: ["reliability", "success"]
  },
  "tool.avg_latency_ms": {
    id: "tool.avg_latency_ms",
    name: "Average Tool Latency",
    description: "Average tool execution time",
    unit: "milliseconds",
    higherIsBetter: false,
    normalization: { type: "linear", min: 0, max: 60000 },
    category: "tool",
    tags: ["performance", "latency"]
  },
  "tool.cost_per_call": {
    id: "tool.cost_per_call",
    name: "Tool Cost Per Call",
    description: "Average cost per tool invocation",
    unit: "USD",
    higherIsBetter: false,
    normalization: { type: "linear", min: 0, max: 10 },
    category: "tool",
    tags: ["cost", "efficiency"]
  },

  // Output quality metrics
  "output.quality_score": {
    id: "output.quality_score",
    name: "Output Quality Score",
    description: "Overall quality assessment of produced output",
    unit: "score",
    higherIsBetter: true,
    normalization: { type: "linear", min: 0, max: 100 },
    category: "output",
    tags: ["quality", "content"]
  },
  "output.schema_compliance": {
    id: "output.schema_compliance",
    name: "Schema Compliance Rate",
    description: "Percentage of outputs matching expected schema",
    unit: "percentage",
    higherIsBetter: true,
    normalization: { type: "linear", min: 0, max: 100 },
    category: "output",
    tags: ["compliance", "structure"]
  },
  "output.brand_safety": {
    id: "output.brand_safety",
    name: "Brand Safety Score",
    description: "Brand safety compliance score",
    unit: "percentage",
    higherIsBetter: true,
    normalization: { type: "linear", min: 95, max: 100 },
    category: "output",
    tags: ["safety", "brand", "compliance"]
  },
};