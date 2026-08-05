/**
 * Tool Invocation and Execution Context (Req #6).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { ToolId, AgentId, WorkflowId, StepId, InvocationId, CorrelationId, TraceId, Timestamp, Json } from "./common";
import type { ApprovalDecision } from "./tool";
import type { ResolvedCredentials, SandboxConfig, CancellationToken } from "./tool";

/** Context passed to tool invocation. */
export interface InvocationContext {
  /** Unique invocation ID. */
  invocationId: string;
  /** Agent requesting execution. */
  agent: string;
  /** Workflow context (if applicable). */
  workflowId?: string;
  stepId?: string;
  /** Correlation ID for tracing. */
  correlationId: string;
  /** Trace ID for distributed tracing. */
  traceId: string;
  /** Deadline for this invocation. */
  deadline: string;
  /** Approval decision (if approval required). */
  approvalDecision?: ApprovalDecision;
  /** Resolved credentials for authentication. */
  credentials: ResolvedCredentials;
  /** Sandbox configuration for this invocation. */
  sandboxConfig: SandboxConfig;
  /** Cancellation token for cooperative cancellation. */
  cancellationToken: CancellationToken;
}

/** Approval decision from approval gate. */
export interface ApprovalDecision {
  invocationId: string;
  approved: boolean;
  approver: string;
  reason: string;
  conditions?: string[];
  decidedAt: string;
}

/** Resolved credentials for tool execution. */
export interface ResolvedCredentials {
  headers?: Record<string, string>;
  queryParams?: Record<string, string>;
  bodyParams?: Record<string, string>;
  envVars?: Record<string, string>;
  certificates?: Certificate[];
}

export interface Certificate {
  name: string;
  cert: string;
  key?: string;
}

export interface SandboxConfig {
  level: "none" | "process" | "container" | "vm" | "wasm";
  memoryLimitMb?: number;
  cpuTimeLimitSec?: number;
  networkAccess: boolean;
  allowedHosts?: string[];
  filesystemAccess: "none" | "read" | "readwrite" | "temp_only";
  allowedPaths?: string[];
  envVars?: Record<string, string>;
  resourceLimits?: ResourceLimits;
}

export interface ResourceLimits {
  maxProcesses?: number;
  maxFileDescriptors?: number;
  maxMemoryMb?: number;
  cpuQuotaPercent?: number;
}

/** Cancellation token for cooperative cancellation. */
export interface CancellationToken {
  isCancelled: boolean;
  onCancelled(handler: () => void): void;
  throwIfCancelled(): void;
}

/** Approval decision from approval gate. */
export interface ApprovalDecision {
  invocationId: string;
  approved: boolean;
  approver: string;
  reason: string;
  conditions?: string[];
  decidedAt: string;
}

/** Result of a tool invocation. */
export interface ToolResult {
  resultId: string;
  toolId: string;
  success: boolean;
  output: any;
  error?: ToolError;
  metadata: ExecutionMetadata;
}

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  details?: any;
  cause?: ToolError;
}

export type ToolErrorCode =
  | "VALIDATION_ERROR"
  | "PERMISSION_DENIED"
  | "APPROVAL_REJECTED"
  | "TIMEOUT"
  | "SANDBOX_ERROR"
  | "AUTHENTICATION_ERROR"
  | "RATE_LIMITED"
  | "PROVIDER_ERROR"
  | "VALIDATION_ERROR"
  | "SANDBOX_VIOLATION"
  | "COST_EXCEEDED"
  | "UNKNOWN";

export interface ExecutionMetadata {
  toolId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  tokensUsed?: TokenUsage;
  costUsd: number;
  retryCount: number;
  cached: boolean;
  sandboxInfo: SandboxInfo;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface SandboxInfo {
  sandboxId: string;
  level: string;
  memoryUsedMb?: number;
  cpuTimeMs?: number;
}