/**
 * Growth Agent types.
 *
 * A decision/recommendation specialist: it consumes a validated analytics_report
 * (plus upstream lineage) and produces a traceable growth recommendation. It is
 * deterministic, calls no capabilities, and never invents metrics — every
 * recommendation traces to metrics that were actually supplied in the analytics
 * report.
 */

import type { BaseAgentDependencies, ExecutionContext, ExecutionResponse, Json, Uuid } from "@ai-media-factory/runtime";
import type { PerformanceMetrics } from "@ai-media-factory/tool-framework";

/** A serialized upstream artifact in the content collaboration chain. */
export interface GrowthSourceArtifact {
  artifactId: string;
  kind: string;
  producerAgent: string;
  workflowId: string;
  correlationId: string;
  status: string;
  createdAt: string;
  parentArtifact?: { artifactId: string; kind: string };
  payload: Json;
}

/** Input to the growth agent: a validated analytics report and workflow context. */
export interface GrowthInput {
  requestId: Uuid;
  objective: string;
  taskDescription?: string;
  /** The validated content chain; a completed analytics_report is required. */
  validatedArtifacts?: readonly GrowthSourceArtifact[];
}

export type GrowthStatus = "completed" | "blocked" | "failed";

/** A statistically derived "winning" pattern, grounded in a supplied metric. */
export interface WinningPattern {
  metric: string;
  value: number;
  observation: string;
}

/** A losing/weak pattern, grounded in a supplied metric. */
export interface LosingPattern {
  metric: string;
  value: number;
  reason: string;
}

export type RecommendationPriority = "high" | "medium" | "low";

/** A single growth recommendation; `basedOn` lists the exact metric keys used. */
export interface GrowthRecommendationEntry {
  id: string;
  action: string;
  rationale: string;
  basedOn: readonly string[];
  priority: RecommendationPriority;
}

/** A proposed controlled experiment that traces to supplied metrics. */
export interface GrowthExperiment {
  id: string;
  hypothesis: string;
  expectedImpact: string;
  successMetric: string;
}

/** An ordered focus area. */
export interface GrowthPriority {
  rank: number;
  focus: string;
  reason: string;
}

export interface GrowthReport {
  recommendationId: Uuid;
  objective: string;
  contentId: string;
  status: GrowthStatus;
  summary: string;
  winningPatterns: readonly WinningPattern[];
  losingPatterns: readonly LosingPattern[];
  recommendations: readonly GrowthRecommendationEntry[];
  experiments: readonly GrowthExperiment[];
  priorities: readonly GrowthPriority[];
  confidence: number;
  sourceArtifactReferences: readonly { artifactId: string; kind: string }[];
  metadata: Record<string, Json>;
  createdAt: string;
}

/**
 * Deterministic thresholds used to classify supplied metrics into winning/losing
 * patterns. These are analysis bounds (configuration), not fabricated metrics.
 */
export interface GrowthThresholds {
  /** completionRate at/above this is a winning pattern. */
  strongCompletionRate: number;
  /** completionRate below this is a losing pattern. */
  weakCompletionRate: number;
  /** clickThroughRate at/above this is a winning pattern. */
  strongClickThroughRate: number;
  /** clickThroughRate below this is a losing pattern. */
  weakClickThroughRate: number;
  /** Absolute engagement count at/above which engagement is strong. */
  strongEngagementFloor: number;
}

export interface GrowthConfig {
  /** Model, retained for interface parity; the Growth Agent is deterministic. */
  model: string;
  systemPrompt: string;
  includeReasoning?: boolean;
  thresholds?: Partial<GrowthThresholds>;
}

export interface GrowthDependencies extends BaseAgentDependencies {
  config: GrowthConfig;
}

export interface GrowthExecutionInput {
  context: ExecutionContext;
  input: GrowthInput;
}

export interface GrowthExecutionOutput {
  output: GrowthReport;
  response: ExecutionResponse;
}