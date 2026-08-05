/**
 * Tool Invocation and Execution Context (Req #6).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { ToolId, AgentId, WorkflowId, StepId, InvocationId, CorrelationId, TraceId, Timestamp, Json } from "./common.js";
import type { ApprovalDecision, ResolvedCredentials, SandboxConfig, CancellationToken, ToolResult, ToolError, ExecutionMetadata, TokenUsage, SandboxInfo } from "./tool.js";

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

export type {
  ApprovalDecision,
  ResolvedCredentials,
  SandboxConfig,
  CancellationToken,
  ToolResult,
  ToolError,
  ExecutionMetadata,
  TokenUsage,
  SandboxInfo,
} from "./tool.js";