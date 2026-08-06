/**
 * Default WorkflowLogger implementation.
 */

import type { Json, StepId, Uuid, LogLevel, WorkflowLogFields, WorkflowLogger } from "../observability/logging.js";

export class DefaultWorkflowLogger implements WorkflowLogger {
  log(level: LogLevel, message: string, fields: WorkflowLogFields): void {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...fields,
    };
    console.log(JSON.stringify(logEntry));
  }
}