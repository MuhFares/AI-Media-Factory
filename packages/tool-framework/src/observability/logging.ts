/**
 * Tool Logging (Req #12).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface ToolLogger {
  logInvocation(entry: InvocationLogEntry): void;
  logResult(result: ToolResult): void;
  logError(error: ToolError, context: any): void;
}

export interface InvocationLogEntry {
  invocationId: string;
  toolId: string;
  agent: string;
  workflowId?: string;
  inputHash: string;
  startedAt: string;
  status: "started" | "completed" | "failed" | "cancelled";
}

export interface ToolError {
  code: string;
  message: string;
  retryable: boolean;
  details?: any;
  cause?: any;
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