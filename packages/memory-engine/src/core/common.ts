/**
 * Shared primitives for the memory engine.
 * ARCHITECTURE ONLY — type declarations, no logic.
 */

export type AgentId = string;
export type MemoryId = string;
export type Timestamp = string; // ISO-8601 UTC

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

/** The nine memory types from the Memory Architecture (the scope of any op). */
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

/** Durability class, derived from the type; governs delete/expire rules. */
export type Durability = "ephemeral" | "rolling" | "durable" | "permanent";
