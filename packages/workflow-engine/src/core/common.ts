/**
 * Shared primitives for the workflow engine.
 * ARCHITECTURE ONLY — type declarations, no logic.
 */

export type Uuid = string;
export type Timestamp = string; // ISO-8601 UTC
export type StepId = string;
export type WorkflowId = string;

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

/** The per-workflow execution states (owned by the workflow engine). */
export type WorkflowState =
  | "PENDING"
  | "RUNNING"
  | "PAUSED"
  | "AWAITING_APPROVAL"
  | "RETRYING"
  | "COMPENSATING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "ESCALATED";
