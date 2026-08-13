/**
 * Analytics Agent types.
 */

import type { BaseAgentDependencies, ExecutionContext, ExecutionResponse, Json, Uuid } from "@ai-media-factory/runtime";
import type { CapabilityRequest, CapabilityResult } from "@ai-media-factory/runtime";
import type { PerformanceMetrics } from "@ai-media-factory/tool-framework";

/** A serialized upstream artifact in the content collaboration chain. */
export interface AnalyticsSourceArtifact {
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

/** Input to the analytics agent: a published artifact and workflow context. */
export interface AnalyticsInput {
  requestId: Uuid;
  objective: string;
  taskDescription?: string;
  /** The validated content chain; a completed published_report is required. */
  validatedArtifacts?: readonly AnalyticsSourceArtifact[];
}

export type AnalyticsStatus = "completed" | "blocked" | "failed";

export interface PerformanceReport {
  reportId: Uuid;
  contentId: string;
  publicationId: string;
  platform: string;
  retrievedAt: string;
  status: AnalyticsStatus;
  summary: string;
  metrics: PerformanceMetrics;
  source: string;
  sourceId: string;
  executionEvidencePresent: boolean;
  metadata: Record<string, Json>;
  capabilityExecutions: readonly CapabilityResult[];
  createdAt: string;
}

export interface AnalyticsConfig {
  /** Model, retained for interface parity; the Analytics Agent is deterministic. */
  model: string;
  platform: string;
  systemPrompt: string;
  includeReasoning?: boolean;
}

export interface AnalyticsDependencies extends BaseAgentDependencies {
  config: AnalyticsConfig;
}

export interface AnalyticsExecutionInput {
  context: ExecutionContext;
  input: AnalyticsInput;
}

export interface AnalyticsExecutionOutput {
  output: PerformanceReport;
  response: ExecutionResponse;
}