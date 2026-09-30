/**
 * Publisher Agent types.
 */

import type { BaseAgentDependencies, ExecutionContext, ExecutionResponse, Json, Uuid } from "@ai-media-factory/runtime";
import type { CapabilityRequest, CapabilityResult } from "@ai-media-factory/runtime";

/** A serialized upstream artifact in the content collaboration chain. */
export interface PublisherSourceArtifact {
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

/** Input to the publisher agent: the validated content chain and workflow context. */
export interface PublisherInput {
  requestId: Uuid;
  objective: string;
  taskDescription?: string;
  /** Optional publishing instructions (e.g. caption/tags). */
  instructions?: string;
  /** The validated content chain, required to include the completed video and a passing final QA. */
  validatedArtifacts?: readonly PublisherSourceArtifact[];
  /** Required for the governed final-media publication path. */
  publisherAuthorization?: PublisherAuthorization;
}

export interface PublisherAuthorization {
  authorizationId: string;
  workflowId: string;
  finalMediaArtifactId: string;
  finalTechnicalQAReportId: string;
  finalProductReviewId: string;
  humanApprovalId: string;
  status: "AUTHORIZED";
  scope: "PUBLIC_PUBLISH" | "PRIVATE_VALIDATION";
  authorityBinding: {
    projectId: string;
    workflowId: string;
    projectMode: string;
    finalMediaArtifactId: string;
    finalMediaSha256: string;
    finalProductReviewId: string;
    targetPlatform: string;
    targetAccountId: string;
    publicationPayloadHash: string;
    publicationIdentity: string;
  };
  issuedAt: string;
  policyVersion: string;
}

export type PublishStatus = "completed" | "blocked" | "failed";

export interface PublishedReport {
  reportId: Uuid;
  taskDescription: string;
  objective: string;
  status: PublishStatus;
  summary: string;
  publicationId: string;
  platform: string;
  idempotencyKey: string;
  publishedUrl: string;
  publishedAt: string;
  sourceVideoId: string;
  finalMediaArtifactId: string;
  finalMediaSha256: string;
  mediaTransportType: string;
  mediaTransportFingerprint: string;
  providerId: string;
  executionEvidencePresent: boolean;
  metadata: Record<string, Json>;
  capabilityExecutions: readonly CapabilityResult[];
  createdAt: string;
}

export interface PublisherConfig {
  /** Model, retained for interface parity; the Publisher Agent is deterministic. */
  model: string;
  /** The single implemented publishing platform. */
  platform: string;
  systemPrompt: string;
  includeReasoning?: boolean;
}

export interface PublisherDependencies extends BaseAgentDependencies {
  config: PublisherConfig;
}

export interface PublisherExecutionInput {
  context: ExecutionContext;
  input: PublisherInput;
}

export interface PublisherExecutionOutput {
  output: PublishedReport;
  response: ExecutionResponse;
}
