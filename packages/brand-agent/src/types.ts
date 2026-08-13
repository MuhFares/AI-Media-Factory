/**
 * Brand Gate Agent types.
 *
 * The Brand Gate is a production quality gate. It consumes an SEO artifact
 * through the normal collaboration handoff and evaluates it (and its writer
 * lineage reference) against supplied brand configuration. It never invents
 * brand facts: all brand guidance must be supplied, and any source reference
 * must trace to the upstream SEO artifact.
 */

import type { Uuid, Json } from "@ai-media-factory/runtime";
import type { ExecutionContext, ExecutionResponse } from "@ai-media-factory/runtime";
import type { PlanTask } from "@ai-media-factory/planner-agent";

/** An SEO artifact consumed through the normal collaboration handoff. */
export interface SEOArtifactHandoff {
  readonly artifactId: string;
  readonly kind: string;
  readonly payload: Json;
}

/** A single brand-check outcome. */
export interface BrandCheck {
  readonly code: string;
  readonly message: string;
}

/** Input to the brand gate: the objective, SEO handoff, and optional brand guidance. */
export interface BrandAgentInput {
  /** The content-production objective being gated. */
  readonly objective: string;
  /** Optional originating task, used for provenance/description. */
  readonly task?: PlanTask;
  /**
   * The SEO artifact handed off through `previousArtifact`. Required: the gate
   * refuses to evaluate without a valid SEO report.
   */
  readonly previousArtifact?: SEOArtifactHandoff;
  /** Optional supplied brand guidelines. Never invented by the agent. */
  readonly brandConfig?: string;
}

/** Truthful, deterministic brand-gate statuses. */
export type BrandStatus = "approved" | "needs_revision" | "rejected";

/** A recommendation accompanying the verdict. */
export interface BrandRecommendation {
  readonly priority: "high" | "medium" | "low";
  readonly description: string;
}

/** The complete brand review report output by the gate. */
export interface BrandReviewReport {
  readonly reportId: Uuid;
  readonly taskDescription: string;
  readonly objective: string;
  readonly status: BrandStatus;
  readonly issues: readonly BrandCheck[];
  readonly passedChecks: readonly BrandCheck[];
  readonly failedChecks: readonly BrandCheck[];
  readonly recommendations: readonly BrandRecommendation[];
  readonly metadata: {
    readonly createdAt: string;
    readonly agentVersion: string;
    readonly seoArtifactId: string;
  };
}

/** Brand agent configuration (LLM execution dependency only). */
export interface BrandConfig {
  readonly model: string;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly systemPrompt: string;
  readonly includeReasoning?: boolean;
}

/** Brand execution input (extends the base agent input). */
export interface BrandExecutionInput {
  context: ExecutionContext;
  input: BrandAgentInput;
}

/** Brand execution output (extends the base agent output). */
export interface BrandExecutionOutput {
  output: BrandReviewReport;
  response: ExecutionResponse;
}