/**
 * Thumbnail Agent types.
 */

import type { BaseAgentDependencies, ExecutionContext, ExecutionResponse, Json, Uuid } from "@ai-media-factory/runtime";
import type { CapabilityRequest, CapabilityResult } from "@ai-media-factory/runtime";

/** A serialized upstream artifact in the content collaboration chain. */
export interface ThumbnailSourceArtifact {
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

/** Input to the thumbnail agent: the validated content chain and objective. */
export interface ThumbnailAgentInput {
  requestId: Uuid;
  objective: string;
  taskDescription?: string;
  /** Present → thumbnail derives its prompt from the content chain. */
  validatedArtifacts?: readonly ThumbnailSourceArtifact[];
}

export type ThumbnailReportStatus = "completed" | "blocked" | "failed";

export interface ThumbnailReport {
  reportId: Uuid;
  taskDescription: string;
  objective: string;
  status: ThumbnailReportStatus;
  summary: string;
  imageId: string;
  imageUrl: string;
  imageTitle: string;
  providerId: string;
  executionEvidencePresent: boolean;
  metadata: {
    createdAt: string;
    agentVersion: string;
  };
}

export interface ThumbnailConfig {
  /** Model, retained for interface parity; the Thumbnail Agent is deterministic. */
  model: string;
  /** Maximum image generation prompt length. */
  maxPromptLength: number;
  /** Default aspect ratio for the generated thumbnail. */
  aspectRatio: string;
  /** Accepted aspect ratios passed through to the capability. */
  allowedAspectRatios: readonly string[];
  systemPrompt: string;
  includeReasoning?: boolean;
}

export interface ThumbnailAgentDependencies extends BaseAgentDependencies {
  config: ThumbnailConfig;
}

export interface ThumbnailExecutionInput {
  context: ExecutionContext;
  input: ThumbnailAgentInput;
}

export interface ThumbnailExecutionOutput {
  output: ThumbnailReport & { capabilityExecutions?: readonly CapabilityResult[] };
  response: ExecutionResponse;
}