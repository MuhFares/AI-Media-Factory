/**
 * Tool Result and Error Types (Req #7).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { ToolId, ResultId, Timestamp, Json } from "../core/common";

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

export interface ToolError {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  details?: any;
  cause?: ToolError;
}

export interface ToolResult {
  resultId: string;
  toolId: string;
  success: boolean;
  output: any;
  error?: ToolError;
  metadata: ExecutionMetadata;
}

export interface ExecutionMetadata {
  toolId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  tokensUsed?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  costUsd: number;
  retryCount: number;
  cached: boolean;
  sandboxInfo: SandboxInfo;
}

export interface SandboxInfo {
  sandboxId: string;
  level: string;
  memoryUsedMb?: number;
  cpuTimeMs?: number;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}