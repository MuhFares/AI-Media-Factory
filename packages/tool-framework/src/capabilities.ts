/**
 * Capability contracts.
 *
 * This module defines the boundary between an agent and a future capability
 * implementation. It intentionally contains no tool or operating-system
 * execution logic.
 */

import type { Json, JsonSchema } from "./core/common.js";

/** Stable identifier for a capability, for example `filesystem.read`. */
export type CapabilityId = `${string}.${string}`;

/** Capability patterns used by authorization policies. */
export type CapabilityPattern = CapabilityId | `${string}.*`;

export interface CapabilityRequest<TInput = Json> {
  requestId: string;
  capabilityId: CapabilityId;
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
  exitCode?: number;
  stdoutRef?: string;
  stderrRef?: string;
  workingDirectory?: string;
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
}

export type CapabilityResult<TOutput = Json> =
  | CapabilitySuccess<TOutput>
  | CapabilityBlocked
  | CapabilityFailure;

export interface CapabilityExecutorPort {
  execute<TInput = Json, TOutput = Json>(
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
