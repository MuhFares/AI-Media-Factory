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
export type SectionType =
  | "system"
  | "company_brain"
  | "agent_brain"
  | "workflow_context"
  | "memory"
  | "examples"
  | "task"
  | "output_schema"
  | "safety";

/** Model context window size (tokens). */
export type ContextWindow = number;