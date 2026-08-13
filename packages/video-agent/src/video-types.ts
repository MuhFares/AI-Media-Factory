/**
 * Video Agent types.
 */

import type { BaseAgentDependencies, ExecutionContext, ExecutionResponse, Json, Uuid } from "@ai-media-factory/runtime";
import type { CapabilityRequest, CapabilityResult } from "@ai-media-factory/runtime";

/** A serialized upstream artifact in the content collaboration chain. */
export interface VideoSourceArtifact {
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

/** Input to the video agent: the validated content chain and workflow context. */
export interface VideoAgentInput {
  requestId: Uuid;
  objective: string;
  taskDescription?: string;
  /** Optional video-specific instructions. */
  instructions?: string;
  /** Present → video validates the content chain before requesting generation. */
  validatedArtifacts?: readonly VideoSourceArtifact[];
}

export type VideoReportStatus = "completed" | "blocked" | "failed";

export interface VideoReport {
  reportId: Uuid;
  taskDescription: string;
  objective: string;
  status: VideoReportStatus;
  summary: string;
  videoId: string;
  videoUrl: string;
  videoTitle: string;
  providerId: string;
  jobId: string;
  durationSeconds: number;
  aspectRatio: string;
  executionEvidencePresent: boolean;
  metadata: {
    createdAt: string;
    agentVersion: string;
  };
}

export interface VideoConfig {
  /** Model, retained for interface parity; the Video Agent is deterministic. */
  model: string;
  /** Maximum video generation prompt length. */
  maxPromptLength: number;
  /** Default aspect ratio for the generated video. */
  aspectRatio: string;
  /** Accepted aspect ratios passed through to the capability. */
  allowedAspectRatios: readonly string[];
  /** Default duration (seconds) requested for the video. */
  durationSeconds: number;
  systemPrompt: string;
  includeReasoning?: boolean;
}

export interface VideoAgentDependencies extends BaseAgentDependencies {
  config: VideoConfig;
}

export interface VideoExecutionInput {
  context: ExecutionContext;
  input: VideoAgentInput;
}

export interface VideoExecutionOutput {
  output: VideoReport & { capabilityExecutions?: readonly CapabilityResult[] };
  response: ExecutionResponse;
}