/**
 * Tool Invocation (Req #6).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { ToolId, AgentId, WorkflowId, StepId, InvocationId, CorrelationId, TraceId, Timestamp, Json } from "../core/common.js";
import type { InvocationContext, ToolResult, CancellationToken, ApprovalDecision, ResolvedCredentials, SandboxConfig } from "../core/execution.js";

export interface ToolInvoker {
  /** Execute a tool with full framework pipeline. */
  invoke(toolId: string, input: any, context: InvocationContext): Promise<ToolResult>;
}

export type {
  InvocationContext,
  ToolResult,
  CancellationToken,
  ApprovalDecision,
  ResolvedCredentials,
  SandboxConfig,
} from "../core/execution.js";