/**
 * Capability contracts.
 *
 * This module defines the boundary between an agent and a future capability
 * implementation. It intentionally contains no tool or operating-system
 * execution logic.
 */

import type { Json, JsonSchema } from "./core/common.js";

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
  error?: { code: string; message: string };
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
