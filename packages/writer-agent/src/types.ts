/**
 * Writer Agent types.
 *
 * The Writer is a production specialist: it consumes a research report through
 * the normal collaboration handoff and produces a deterministic, source-linked
 * content artifact. It never fabricates sources or evidence — every source
 * reference must trace to the supplied research report.
 */

import type { Uuid, Json } from "@ai-media-factory/runtime";
import type { ExecutionContext, ExecutionResponse } from "@ai-media-factory/runtime";
import type { PlanTask } from "@ai-media-factory/planner-agent";

/** A research artifact consumed through the normal collaboration handoff. */
export interface ResearchArtifactHandoff {
  readonly artifactId: string;
  readonly kind: string;
  readonly payload: Json;
}

export interface EvidenceBackedBriefHandoff extends ResearchArtifactHandoff {
  readonly kind: "evidence_backed_content_brief";
}

/** Input to the writer: the writing objective plus the research handoff. */
export interface WriterAgentInput {
  /** The content-production objective given to the writer. */
  readonly objective: string;
  /** Optional originating task, used for provenance/description. */
  readonly task?: PlanTask;
  /**
   * The research artifact handed off through `previousArtifact`. Required: the
   * writer must not fabricate research evidence, so it refuses to run without
   * a valid research report.
   */
  readonly previousArtifact?: ResearchArtifactHandoff;
  /** Normalized evidence context; provider-native payloads are not accepted here. */
  readonly researchEvidence?: readonly Json[];
  /** Production wiring sets this to prevent the legacy direct research handoff. */
  readonly requireSynthesis?: boolean;
  /**
   * Revision Cycle directive: when present, the writer REVISES the prior
   * content per the authoritative Review findings instead of writing from
   * scratch. The durable revision lineage travels with the request.
   */
  readonly revision?: WriterRevisionDirective;
}

/** Authoritative revision instruction sourced from a persisted Review artifact. */
export interface WriterRevisionDirective {
  readonly revisionTaskId: string;
  readonly revisionVersion: number;
  readonly reviewArtifactId: string;
  readonly reviewExecutionId: string;
  readonly priorWriterArtifactId: string;
  readonly summary: string;
  readonly findings: readonly Json[];
  readonly recommendations: readonly Json[];
  readonly priorTitle: string;
  readonly priorContent: string;
}

/** A source reference in the produced content, restricted to research sources. */
export interface WriterSourceReference {
  readonly sourceId: number;
  readonly title: string;
  readonly url: string;
}

/** Truthful, deterministic writer statuses. */
export type WriterStatus = "completed" | "failed" | "blocked";

/** The complete content artifact output by the writer. */
export interface WriterReport {
  readonly contentId: Uuid;
  readonly taskDescription: string;
  readonly objective: string;
  readonly title: string;
  readonly content: string;
  readonly summary: string;
  readonly sourceReferences: WriterSourceReference[];
  readonly status: WriterStatus;
  readonly metadata: {
    readonly createdAt: string;
    readonly agentVersion: string;
    readonly researchArtifactId: string;
  };
}

/** Writer agent configuration (LLM execution dependency only). */
export interface WriterConfig {
  readonly model: string;
  readonly temperature: number;
  readonly maxOutputTokens: number;
  readonly systemPrompt: string;
  readonly includeReasoning?: boolean;
}

/** Writer execution input (extends the base agent input). */
export interface WriterExecutionInput {
  context: ExecutionContext;
  input: WriterAgentInput;
}

/** Writer execution output (extends the base agent output). */
export interface WriterExecutionOutput {
  output: WriterReport;
  response: ExecutionResponse;
}
