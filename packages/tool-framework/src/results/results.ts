/**
 * Tool Result and Error Types (Req #7).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { ToolId, ResultId, Timestamp, Json } from "../core/common.js";
import type { ToolErrorCode, ToolError, ToolResult, ExecutionMetadata, TokenUsage, SandboxInfo } from "../core/tool.js";

export type {
  ToolErrorCode,
  ToolError,
  ToolResult,
  ExecutionMetadata,
  TokenUsage,
  SandboxInfo,
} from "../core/tool.js";