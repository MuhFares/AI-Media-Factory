/**
 * Shared primitives for the Prompt Compiler.
 * ARCHITECTURE ONLY — type declarations, no logic.
 */

export type AgentId = string;
export type Uuid = string;
export type Timestamp = string; // ISO-8601 UTC

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

/** The 11 section types in enforced assembly order. */
export enum SectionType {
  System = "system",
  CompanyBrain = "company_brain",
  AgentBrain = "agent_brain",
  WorkflowContext = "workflow_context",
  Memory = "memory",
  Examples = "examples",
  Task = "task",
  OutputSchema = "output_schema",
  Safety = "safety",
}

export interface JsonSchema {
  readonly [key: string]: Json;
}

/** Model context window size (tokens). */
export type ContextWindow = number;
