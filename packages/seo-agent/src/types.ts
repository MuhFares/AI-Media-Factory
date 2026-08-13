/**
 * SEO Agent types.
 *
 * The SEO specialist consumes a writer artifact through the normal collaboration
 * handoff and produces a deterministic, source-linked SEO report. It never
 * fabricates source/reference information — any source reference must trace to
 * the writer artifact (and ultimately to the research report through lineage).
 */

import type { Uuid, Json } from "@ai-media-factory/runtime";
import type { ExecutionContext, ExecutionResponse } from "@ai-media-factory/runtime";
import type { PlanTask } from "@ai-media-factory/planner-agent";

/** A writer artifact consumed through the normal collaboration handoff. */
export interface WriterArtifactHandoff {
  readonly artifactId: string;
  readonly kind: string;
  readonly payload: Json;
}

/** A source reference traceable to the writer artifact's own references. */
export interface SEOSourceReference {
  readonly sourceId: number;
  readonly title: string;
  readonly url: string;
}

/** A target keyword proposed for the content. */
export interface SEOKeyword {
  readonly keyword: string;
  readonly importance: "primary" | "secondary";
}

/** A topic the content should cover, grounded in the supplied content. */
export interface SEOTopic {
  readonly topic: string;
  readonly presentInContent: boolean;
}

/** Declared search intent for the content (no external search is implied). */
export type SEOSearchIntent = "informational" | "commercial" | "transactional" | "navigational";

/** A content-structure recommendation section. */
export interface SEOContentStructureItem {
  readonly heading: string;
  readonly purpose: string;
}

/** Input to the SEO agent: the objective plus the writer artifact handoff. */
export interface SEOAgentInput {
  /** The content-production objective. */
  readonly objective: string;
  /** Optional originating task, used for provenance/description. */
  readonly task?: PlanTask;
  /**
   * The writer artifact handed off through `previousArtifact`. Required: the
   * SEO agent refuses to run without a valid writer report.
   */
  readonly previousArtifact?: WriterArtifactHandoff;
}

/** Truthful, deterministic SEO statuses. */
export type SEOStatus = "completed" | "failed" | "blocked";

/** The complete SEO report output by the SEO agent. */
export interface SEOReport {
  readonly reportId: Uuid;
  readonly taskDescription: string;
  readonly objective: string;
  readonly optimizedTitle: string;
  readonly optimizedDescription: string;
  readonly keywords: readonly SEOKeyword[];
  readonly topics: readonly SEOTopic[];
  readonly searchIntent: SEOSearchIntent;
  readonly contentStructure: readonly SEOContentStructureItem[];
  readonly sourceReferences: readonly SEOSourceReference[];
  readonly status: SEOStatus;
  readonly metadata: {
    readonly createdAt: string;
    readonly agentVersion: string;
    readonly writerArtifactId: string;
  };
}

/** SEO agent configuration (LLM execution dependency only). */
export interface SEOConfig {
  readonly model: string;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly systemPrompt: string;
  readonly includeReasoning?: boolean;
}

/** SEO execution input (extends the base agent input). */
export interface SEOExecutionInput {
  context: ExecutionContext;
  input: SEOAgentInput;
}

/** SEO execution output (extends the base agent output). */
export interface SEOExecutionOutput {
  output: SEOReport;
  response: ExecutionResponse;
}