/**
 * Capability contracts.
 *
 * This module defines the boundary between an agent and a future capability
 * implementation. It intentionally contains no tool or operating-system
 * execution logic.
 */

import type { Json, JsonSchema } from "./core/common.js";

export interface ProviderFailureMetadata {
  httpStatus: number | null;
  providerErrorCode: string | null;
  providerErrorType: string | null;
  detail: string | null;
  retryable: boolean | null;
  classification: string | null;
  provider: string | null;
  model: string | null;
  capability: string | null;
  executionId: string | null;
  attemptNumber: number | null;
  latencyMs: number | null;
  costKind: string | null;
  errorName: string | null;
  safeCauseCode: string | null;
  transportDiagnostic: string | null;
  transportPhase: string | null;
  providerReceiptStatus: "UNKNOWN" | null;
}

/** Stable identifier for a capability, for example `filesystem.read`. */
export type CapabilityId = string;

/** Capability patterns used by authorization policies. */
export type CapabilityPattern = CapabilityId | `${string}.*`;

export interface CapabilityRequest<TInput = Json> {
  requestId: string;
  capabilityId: CapabilityId;
  /** Optional operation discriminator for capabilities with multiple actions. */
  operation?: string;
  agentId: string;
  workflowId: string;
  correlationId: string;
  input: TInput;
  requestedAt: string;
  /**
   * Runtime-only observer invoked at the exact point a governed capability
   * crosses into an external provider invocation. Local authorization/schema
   * validation must complete before this callback runs. It is never serialized
   * into provider payloads or persisted as request data.
   */
  onExternalProviderInvocationStarted?: () => Promise<void>;
}

export interface ExecutionEvidence {
  evidenceId: string;
  capabilityId: CapabilityId;
  executedAt: string;
  durationMs: number;
  command?: string;
  arguments?: readonly string[];
  stdout?: string;
  stderr?: string;
  resultStatus?: "success" | "failed";
  providerId?: string;
  resultCount?: number;
  providerInvoked?: boolean;
  imageId?: string;
  jobId?: string;
  videoId?: string;
  videoStatus?: "submitted" | "running" | "completed" | "failed";
  durationSeconds?: number;
  width?: number;
  height?: number;
  exitCode?: number;
  stdoutRef?: string;
  stderrRef?: string;
  workingDirectory?: string;
  operation?: string;
  requestedPath?: string;
  resolvedPath?: string;
  workflowId?: string;
  correlationId?: string;
  agentId?: string;
  succeeded?: boolean;
  error?: { code: string; message: string; retryable?: boolean; failureMetadata?: ProviderFailureMetadata };
  platform?: string;
  idempotencyKey?: string;
  publicationId?: string;
  publishedUrl?: string;
  publishedAt?: string;
  deduplicated?: boolean;
  /** Submission lifecycle fields for side-effecting async providers. */
  submissionState?: "SUBMITTING" | "SUBMITTED" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "SUBMISSION_OUTCOME_UNKNOWN" | "RECONCILIATION_REQUIRED";
  reconciliationRequired?: boolean;
  initialClientResult?: "TIMEOUT" | "ACCEPTED" | "REJECTED" | "UNKNOWN";
  finalRemoteResult?: "COMPLETED" | "FAILED" | "CANCELLED" | "UNKNOWN";
}

export interface CapabilitySuccess<TOutput = Json> {
  status: "success";
  resultId: string;
  capabilityId: CapabilityId;
  output: TOutput;
  evidence?: ExecutionEvidence;
}

export interface CapabilityBlocked {
  status: "blocked";
  resultId: string;
  capabilityId: CapabilityId;
  reason: string;
}

export interface CapabilityFailure {
  status: "failed";
  resultId: string;
  capabilityId: CapabilityId;
  error: {
    code: string;
    message: string;
    retryable: boolean;
    failureMetadata?: ProviderFailureMetadata;
  };
  evidence?: ExecutionEvidence;
}

export type CapabilityResult<TOutput = Json> =
  | CapabilitySuccess<TOutput>
  | CapabilityBlocked
  | CapabilityFailure;

export interface CapabilityExecutorPort<TInput = Json, TOutput = Json> {
  execute(
    request: CapabilityRequest<TInput>
  ): Promise<CapabilityResult<TOutput>>;
}

export interface CapabilityDescriptor {
  capabilityId: CapabilityId;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
}

export interface CapabilityAuthorization {
  agentId: string;
  allowed: readonly CapabilityPattern[];
}

export interface CapabilityResolver {
  resolve(capabilityId: CapabilityId): CapabilityDescriptor | null;
  isAuthorized(agentId: string, capabilityId: CapabilityId): boolean;
}
