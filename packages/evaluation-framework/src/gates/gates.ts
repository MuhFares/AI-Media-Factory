/**
 * Quality Gates - Automated pass/fail/warn/block decisions.
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Timestamp, Json } from "./common";

/** Quality gate definition. */
export interface QualityGate {
  /** Unique gate identifier. */
  gateId: string;
  /** Human-readable name. */
  name: string;
  /** Description of what this gate checks. */
  description: string;
  /** Metric IDs this gate evaluates. */
  metricIds: string[];
  /** Decision thresholds. */
  thresholds: GateThresholds;
  /** Action when gate fails. */
  onFail: "warn" | "fail" | "block";
  /** Whether this gate is required for pass. */
  required: boolean;
  /** Tags for filtering. */
  tags: string[];
}

export interface GateThresholds {
  /** Minimum score to pass (0-1). */
  passThreshold: number;
  /** Score below which warning is issued (0-1). */
  warnThreshold?: number;
  /** Score below which gate fails (0-1). */
  failThreshold: number;
  /** Score below which execution is blocked (0-1). */
  blockThreshold?: number;
  /** Custom evaluation function name. */
  customEvaluator?: string;
}

export interface GateEvaluationResult {
  gateId: string;
  gateName: string;
  decision: "pass" | "warn" | "fail" | "block";
  score: number;
  thresholds: GateThresholds;
  message: string;
  evaluatedAt: string;
}

/** Predefined quality gates for the platform. */
export const STANDARD_QUALITY_GATES: Record<string, QualityGate> = {
  // Agent gates
  "agent.min_success_rate": {
    gateId: "agent.min_success_rate",
    name: "Minimum Agent Success Rate",
    description: "Agent must maintain minimum task success rate",
    metricIds: ["agent.task_success_rate"],
    thresholds: { passThreshold: 0.95, warnThreshold: 0.97, failThreshold: 0.90, onFail: "fail", required: true },
    onFail: "fail",
    required: true,
    tags: ["agent", "reliability"]
  },
  "agent.max_retry_rate": {
    gateId: "agent.max_retry_rate",
    name: "Maximum Agent Retry Rate",
    description: "Agent retry rate must not exceed threshold",
    metricIds: ["agent.retry_rate"],
    thresholds: { passThreshold: 0.95, warnThreshold: 0.93, failThreshold: 0.90, onFail: "warn", required: true },
    onFail: "warn",
    required: true,
    tags: ["agent", "stability"]
  },
  "agent.max_latency": {
    gateId: "agent.max_latency",
    name: "Maximum Agent Latency",
    description: "Agent average latency must not exceed threshold",
    metricIds: ["agent.avg_latency_ms"],
    thresholds: { passThreshold: 0.9, warnThreshold: 0.85, failThreshold: 0.8, onFail: "warn", required: false },
    onFail: "warn",
    required: false,
    tags: ["agent", "performance"]
  },

  // Provider gates
  "provider.min_availability": {
    gateId: "provider.min_availability",
    name: "Minimum Provider Availability",
    description: "Provider must maintain minimum uptime",
    metricIds: ["provider.availability"],
    thresholds: { passThreshold: 0.999, warnThreshold: 0.9995, failThreshold: 0.995, onFail: "fail", required: true },
    onFail: "fail",
    required: true,
    tags: ["provider", "reliability"]
  },
  "provider.max_error_rate": {
    gateId: "provider.max_error_rate",
    name: "Maximum Provider Error Rate",
    description: "Provider error rate must not exceed threshold",
    metricIds: ["provider.error_rate"],
    thresholds: { passThreshold: 0.99, warnThreshold: 0.995, failThreshold: 0.98, onFail: "warn", required: true },
    onFail: "warn",
    required: true,
    tags: ["provider", "reliability"]
  },
  "provider.max_cost": {
    gateId: "provider.max_cost",
    name: "Maximum Provider Cost",
    description: "Provider cost per 1K tokens must not exceed threshold",
    metricIds: ["provider.cost_per_1k_tokens"],
    thresholds: { passThreshold: 0.9, warnThreshold: 0.8, failThreshold: 0.7, onFail: "warn", required: false },
    onFail: "warn",
    required: false,
    tags: ["provider", "cost"]
  },

  // Workflow gates
  "workflow.min_success_rate": {
    gateId: "workflow.min_success_rate",
    name: "Minimum Workflow Success Rate",
    description: "Workflow must maintain minimum success rate",
    metricIds: ["workflow.success_rate"],
    thresholds: { passThreshold: 0.95, warnThreshold: 0.97, failThreshold: 0.90, onFail: "fail", required: true },
    onFail: "fail",
    required: true,
    tags: ["workflow", "reliability"]
  },
  "workflow.max_rework_rate": {
    gateId: "workflow.max_rework_rate",
    name: "Maximum Workflow Rework Rate",
    description: "Rework rate must not exceed threshold",
    metricIds: ["workflow.rework_rate"],
    thresholds: { passThreshold: 0.95, warnThreshold: 0.9, failThreshold: 0.8, onFail: "warn", required: true },
    onFail: "warn",
    required: true,
    tags: ["workflow", "quality"]
  },
  "workflow.min_autonomy": {
    gateId: "workflow.min_autonomy",
    name: "Minimum Workflow Autonomy",
    description: "Workflow must maintain minimum autonomy rate",
    metricIds: ["workflow.autonomy_rate"],
    thresholds: { passThreshold: 0.9, warnThreshold: 0.95, failThreshold: 0.85, onFail: "warn", required: true },
    onFail: "warn",
    required: true,
    tags: ["workflow", "autonomy"]
  },

  // Prompt gates
  "prompt.min_schema_compliance": {
    gateId: "prompt.min_schema_compliance",
    name: "Minimum Schema Compliance",
    description: "Prompt outputs must comply with schema",
    metricIds: ["prompt.schema_compliance"],
    thresholds: { passThreshold: 0.99, warnThreshold: 0.995, failThreshold: 0.95, onFail: "fail", required: true },
    onFail: "fail",
    required: true,
    tags: ["prompt", "compliance"]
  },
  "prompt.min_token_efficiency": {
    gateId: "prompt.min_token_efficiency",
    name: "Minimum Token Efficiency",
    description: "Prompts must be token efficient",
    metricIds: ["prompt.token_efficiency"],
    thresholds: { passThreshold: 0.7, warnThreshold: 0.8, failThreshold: 0.6, onFail: "warn", required: false },
    onFail: "warn",
    required: false,
    tags: ["prompt", "efficiency"]
  },

  // Memory gates
  "memory.min_retrieval_precision": {
    gateId: "memory.min_retrieval_precision",
    name: "Minimum Retrieval Precision",
    description: "Memory retrieval precision must meet threshold",
    metricIds: ["memory.retrieval_precision"],
    thresholds: { passThreshold: 0.85, warnThreshold: 0.9, failThreshold: 0.8, onFail: "warn", required: true },
    onFail: "warn",
    required: true,
    tags: ["memory", "accuracy"]
  },
  "memory.max_conflict_rate": {
    gateId: "memory.max_conflict_rate",
    name: "Maximum Memory Conflict Rate",
    description: "Memory conflicts must stay below threshold",
    metricIds: ["memory.conflict_rate"],
    thresholds: { passThreshold: 0.95, warnThreshold: 0.9, failThreshold: 0.85, onFail: "warn", required: true },
    onFail: "warn",
    required: true,
    tags: ["memory", "consistency"]
  },

  // Tool gates
  "tool.min_success_rate": {
    gateId: "tool.min_success_rate",
    name: "Minimum Tool Success Rate",
    description: "Tools must maintain minimum success rate",
    metricIds: ["tool.success_rate"],
    thresholds: { passThreshold: 0.99, warnThreshold: 0.995, failThreshold: 0.98, onFail: "fail", required: true },
    onFail: "fail",
    required: true,
    tags: ["tool", "reliability"]
  },
  "tool.max_cost": {
    gateId: "tool.max_cost",
    name: "Maximum Tool Cost",
    description: "Tool cost per call must not exceed threshold",
    metricIds: ["tool.cost_per_call"],
    thresholds: { passThreshold: 0.8, warnThreshold: 0.7, failThreshold: 0.6, onFail: "warn", required: false },
    onFail: "warn",
    required: false,
    tags: ["tool", "cost"]
  },

  // Output gates
  "output.min_quality": {
    gateId: "output.min_quality",
    name: "Minimum Output Quality",
    description: "Generated outputs must meet quality threshold",
    metricIds: ["output.quality_score"],
    thresholds: { passThreshold: 0.8, warnThreshold: 0.85, failThreshold: 0.7, onFail: "fail", required: true },
    onFail: "fail",
    required: true,
    tags: ["output", "quality"]
  },
  "output.min_schema_compliance": {
    gateId: "output.min_schema_compliance",
    name: "Minimum Schema Compliance",
    description: "Outputs must comply with schema",
    metricIds: ["output.schema_compliance"],
    thresholds: { passThreshold: 0.99, warnThreshold: 0.995, failThreshold: 0.95, onFail: "fail", required: true },
    onFail: "fail",
    required: true,
    tags: ["output", "compliance"]
  },
  "output.min_brand_safety": {
    gateId: "output.min_brand_safety",
    name: "Minimum Brand Safety",
    description: "All outputs must pass brand safety checks",
    metricIds: ["output.brand_safety"],
    thresholds: { passThreshold: 0.99, warnThreshold: 0.995, failThreshold: 0.98, onFail: "block", required: true },
    onFail: "block",
    required: true,
    tags: ["output", "safety", "brand"]
  },
};