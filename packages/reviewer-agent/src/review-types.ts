/** Reviewer Agent types. */

import type { Json, Uuid } from "@ai-media-factory/runtime";
import type { BaseAgentDependencies, ExecutionContext, ExecutionRequest, ExecutionResponse, CancellationToken } from "@ai-media-factory/runtime";
import type { PlanTask } from "@ai-media-factory/planner-agent";

/**
 * Artifact kinds the Reviewer understands. Coding remains the original
 * single domain; writer/seo/brand extend the same reviewer execution path
 * (no second reviewer agent, no new execution boundary).
 */
export type ReviewArtifactKind = "coding_report" | "writer_report" | "seo_report" | "brand_report" | "thumbnail_report";

/** Review domain, derived from the artifact kind under review. */
export type ReviewMode = "coding" | "writer" | "seo" | "brand" | "thumbnail";

/** An upstream artifact handed to the Reviewer for multi-domain review. */
export interface ArtifactUnderReview {
  kind: ReviewArtifactKind;
  artifactId: Uuid | string;
  payload: Json;
}

export interface ReviewContext {
  /** The upstream artifact to review. Present → mode is derived from its kind. */
  artifact?: ArtifactUnderReview;
  task?: PlanTask;
  code?: string;
  changeDescription?: string;
  diff?: string;
  references?: Record<string, Json>;
}

export interface ReviewerInput {
  requestId: Uuid;
  task: PlanTask;
  context?: ReviewContext;
}

export type ReviewFindingSeverity = "critical" | "high" | "medium" | "low" | "info";
export type ReviewFindingCategory = "correctness" | "architecture" | "bug" | "risk" | "security" | "maintainability";

export interface ReviewFinding {
  id: string;
  severity: ReviewFindingSeverity;
  category: ReviewFindingCategory;
  title: string;
  description: string;
  location?: string;
  recommendation: string;
}

export interface ReviewRecommendation {
  priority: "high" | "medium" | "low";
  description: string;
  relatedFindingIds?: string[];
}

export interface ReviewReport {
  reportId: Uuid;
  taskDescription: string;
  summary: string;
  status: "approved" | "changes_requested" | "blocked";
  findings: ReviewFinding[];
  recommendations: ReviewRecommendation[];
  metadata: {
    createdAt: string;
    agentVersion: string;
  };
}

export interface ReviewerConfig {
  model: string;
  temperature: number;
  maxOutputTokens: number;
  systemPrompt: string;
  includeReasoning?: boolean;
}

export interface ReviewerAgentDependencies extends BaseAgentDependencies {
  config: ReviewerConfig;
}

export interface ReviewerExecutionInput {
  context: ExecutionContext;
  input: ReviewerInput;
}

export interface ReviewerExecutionOutput {
  output: ReviewReport;
  response: ExecutionResponse;
}
