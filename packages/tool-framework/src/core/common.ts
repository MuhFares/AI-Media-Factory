/**
 * Shared primitives for the Tool Framework.
 * ARCHITECTURE ONLY — type declarations, no logic.
 */

export type ToolId = string;
export type AgentId = string;
export type WorkflowId = string;
export type StepId = string;
export type InvocationId = string;
export type ResultId = string;
export type TraceId = string;
export type CorrelationId = string;
export type Timestamp = string; // ISO-8601 UTC
export type Approver = string;
export type ProviderId = string;

export type ToolCategory =
  | "web_search"
  | "api_call"
  | "file_operation"
  | "code_execution"
  | "data_processing"
  | "media_generation"
  | "media_processing"
  | "communication"
  | "database"
  | "analysis"
  | "authentication"
  | "monitoring"
  | "custom";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

/** JSON Schema draft-07 document. */
export type JsonSchema = { readonly [key: string]: Json };

/** Standard durations in milliseconds. */
export type Duration = number;