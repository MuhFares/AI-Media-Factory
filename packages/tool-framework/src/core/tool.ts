/**
 * Tool Specification and Interface (Req #1, #2).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * ToolSpec defines what a tool is; Tool defines what it does.
 * The runtime never calls tools directly — it goes through ToolInvoker.
 */

import type { ToolId, AgentId, WorkflowId, StepId, Timestamp, Json, JsonSchema, Duration, ToolCategory } from "./common.js";

export type ToolPermission =
  | "tool:web_search"
  | "tool:api_call"
  | "tool:file_read"
  | "tool:file_write"
  | "tool:code_exec"
  | "tool:media_generate"
  | "tool:api_call_external"
  | "tool:database_query"
  | "tool:media_process"
  | "tool:data_export"
  | "tool:admin"
  | string;

export type AuthRequirement =
  | { type: "none" }
  | { type: "api_key"; keyName: string }
  | { type: "oauth2"; provider: string; scopes: string[] }
  | { type: "bearer_token"; tokenName: string }
  | { type: "mTLS"; certName: string }
  | { type: "aws_iam"; roleArn: string }
  | { type: "gcp_iam"; serviceAccount: string }
  | { type: "custom"; handler: string };

export type SandboxLevel = "none" | "process" | "container" | "vm" | "wasm";

export interface SandboxConfig {
  level: SandboxLevel;
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

export interface RetryPolicyOverride {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  backoffMultiplier?: number;
  jitter?: boolean;
}

export interface ToolSpec {
  id: string;
  name: string;
  category: string;
  version: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  requiredPermissions: string[];
  timeoutMs: number;
  requiresApproval: boolean;
  retryPolicyOverride?: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    backoffMultiplier?: number;
    jitter?: boolean;
  };
  sandboxConfig?: {
    level: "none" | "process" | "container" | "vm" | "wasm";
    memoryLimitMb?: number;
    cpuTimeLimitSec?: number;
    networkAccess: boolean;
    allowedHosts?: string[];
    filesystemAccess: "none" | "read" | "readwrite" | "temp_only";
    allowedPaths?: string[];
    envVars?: Record<string, string>;
    resourceLimits?: {
      maxProcesses?: number;
      maxFileDescriptors?: number;
      maxMemoryMb?: number;
      cpuQuotaPercent?: number;
    };
  };
  authRequirements: Array<{
    type: "none" | "api_key" | "oauth2" | "bearer_token" | "mTLS" | "aws_iam" | "gcp_iam" | "custom";
    keyName?: string;
    provider?: string;
    scopes?: string[];
    tokenName?: string;
    certName?: string;
    roleArn?: string;
    serviceAccount?: string;
    handler?: string;
  }>;
  estimatedCostUsd: number;
  deprecated?: boolean;
  tags: string[];
}

export interface ToolMetadata {
  spec: ToolSpec;
  registeredAt: string;
  registeredBy: string;
  healthStatus: "healthy" | "degraded" | "unhealthy";
  lastHealthCheck: string;
  invocationCount: number;
  successRate: number;
  avgLatencyMs: number;
}

/** The unified tool interface. All tools implement this. */
export interface Tool {
  readonly spec: {
    id: string;
    name: string;
    category: string;
    version: string;
    description: string;
    inputSchema: any;
    outputSchema: any;
    requiredPermissions: string[];
    timeoutMs: number;
    requiresApproval: boolean;
    retryPolicyOverride?: any;
    sandboxConfig?: any;
    authRequirements: any[];
    estimatedCostUsd: number;
    deprecated?: boolean;
    tags: string[];
  };

  /** Execute the tool with given input. */
  invoke(input: any, context: InvocationContext): Promise<ToolResult>;

  /** Health check. */
  health(): Promise<ToolHealth>;
}

export interface ToolHealth {
  healthy: boolean;
  details?: string;
  lastCheck: string;
}

/** Input to a tool invocation. */
export interface ToolInput {
  toolId: string;
  input: any;
  context: InvocationContext;
}

/** Context passed to every tool invocation. */
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

export interface CancellationToken {
  isCancelled: boolean;
  onCancelled(handler: () => void): void;
  throwIfCancelled(): void;
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

/** Approval decision from approval gate. */
export interface ApprovalDecision {
  invocationId: string;
  approved: boolean;
  approver: string;
  reason: string;
  conditions?: string[];
  decidedAt: string;
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
  | "SANDBOX_VIOLATION"
  | "COST_EXCEEDED"
  | "UNKNOWN";

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  details?: any;
  cause?: ToolError;
}

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

/** Result of a tool invocation. */
export interface ToolResult {
  resultId: string;
  toolId: string;
  success: boolean;
  output: any;
  error?: ToolError;
  metadata: ExecutionMetadata;
}

export type { JsonSchema } from "./common.js";