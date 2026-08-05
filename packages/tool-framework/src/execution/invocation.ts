/**
 * Tool Invocation (Req #6).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { ToolId, AgentId, WorkflowId, StepId, InvocationId, CorrelationId, TraceId, Timestamp, Json } from "./common";
import type { InvocationContext, ToolResult, CancellationToken, ApprovalDecision, ResolvedCredentials, SandboxConfig } from "../core/execution";
import type { ToolId } from "../core/common";

export interface ToolInvoker {
  /** Execute a tool with full framework pipeline. */
  invoke(toolId: string, input: any, context: InvocationContext): Promise<ToolResult>;
}

export interface InvocationContext {
  invocationId: string;
  agent: string;
  workflowId?: string;
  stepId?: string;
  correlationId: string;
  traceId: string;
  deadline: string;
  approvalDecision?: ApprovalDecision;
  credentials: ResolvedCredentials;
  sandboxConfig: SandboxConfig;
  cancellationToken: CancellationToken;
}

export interface ApprovalDecision {
  invocationId: string;
  approved: boolean;
  approver: string;
  reason: string;
  conditions?: string[];
  decidedAt: string;
}

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

export interface CancellationToken {
  isCancelled: boolean;
  onCancelled(handler: () => void): void;
  throwIfCancelled(): void;
}

export interface ApprovalDecision {
  invocationId: string;
  approved: boolean;
  approver: string;
  reason: string;
  conditions?: string[];
  decidedAt: string;
}