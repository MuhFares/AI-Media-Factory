/**
 * Shared primitives for the Context Engine.
 * ARCHITECTURE ONLY — type declarations, no logic.
 */

export type AgentId = string;
export type WorkflowId = string;
export type StepId = string;
export type TurnId = string;
export type MemoryId = string;
export type PackageId = string;
export type Timestamp = string; // ISO-8601 UTC
export type CorrelationId = string;
export type BrandId = string;
export type Uuid = string;

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

/** The 9 memory types from Memory Architecture. */
export type MemoryType =
  | "session"
  | "company"
  | "agent"
  | "analytics"
  | "decision"
  | "workflow"
  | "lessons"
  | "checkpoint"
  | "knowledge";

/** Durability class, derived from memory type. */
export type Durability = "ephemeral" | "rolling" | "durable" | "permanent";

/** Agent IDs in the system. */
export type AgentId =
  | "ceo"
  | "orchestrator"
  | "research"
  | "writer"
  | "seo"
  | "thumbnail"
  | "video"
  | "publisher"
  | "analytics"
  | "finance"
  | "growth"
  | "qa"
  | "brand"
  | "orchestrator";

/** Memory types for retrieval. */
export type MemoryType =
  | "session"
  | "company"
  | "agent"
  | "analytics"
  | "decision"
  | "workflow"
  | "lessons"
  | "checkpoint"
  | "knowledge";

/** Durability class. */
export type Durability = "ephemeral" | "rolling" | "durable" | "permanent";