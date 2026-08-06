/**
 * Structured logging (req #19).
 * ARCHITECTURE ONLY — declarations, no logic.
 */

import type { Json, StepId, Uuid } from "../core/common.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface WorkflowLogFields {
  workflow_id?: Uuid;
  correlation_id?: string;
  step_id?: StepId;
  state?: string;
  [key: string]: Json | undefined;
}

/** Correlation-keyed structured logging; never logs secrets. */
export interface WorkflowLogger {
  log(level: LogLevel, message: string, fields: WorkflowLogFields): void;
}

// Re-export for runtime use
export type { Json, StepId, Uuid } from "../core/common.js";
