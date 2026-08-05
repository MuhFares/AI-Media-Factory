/**
 * Tool Logging (Req #12).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { ToolResult, ToolError, ExecutionMetadata, SandboxInfo } from "../core/tool.js";

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

export type {
  ToolResult,
  ToolError,
  ExecutionMetadata,
  SandboxInfo,
} from "../core/tool.js";