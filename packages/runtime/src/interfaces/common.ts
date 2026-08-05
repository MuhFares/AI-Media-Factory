/**
 * Shared primitive types used across all runtime contracts.
 * ARCHITECTURE ONLY — type declarations, no logic.
 */

/** Stable identifier of any of the 13 agents (data, not an enum the runtime branches on). */
export type AgentId = string;

/** The event `type` field from the shared envelope (e.g. "ResearchFinished"). */
export type EventType = string;

/** ISO-8601 UTC timestamp. */
export type Timestamp = string;

/** A universally unique id (uuid v4). */
export type Uuid = string;

/** JSON value (payloads and memory bodies are arbitrary JSON). */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };
