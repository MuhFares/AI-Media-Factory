/**
 * Default DeadLetterSink implementation.
 */

import type { StepId, Timestamp, Uuid, Json } from "../core/common.js";
import type { WorkflowDeadLetter, DeadLetterSink } from "../resilience/dead-letter.js";
import type { WorkflowEventBridge } from "../integration/events.js";

export class DefaultDeadLetterSink implements DeadLetterSink {
  constructor(
    private readonly eventBridge: WorkflowEventBridge
  ) {}

  async deadLetter(entry: WorkflowDeadLetter): Promise<void> {
    const payload: Json = {
      workflowId: entry.workflowId,
      definitionId: entry.definitionId,
      definitionVersion: entry.definitionVersion,
      failedStep: entry.failedStep,
      reason: entry.reason,
      lastError: entry.lastError,
      checkpointRef: entry.checkpointRef,
      deadLetteredAt: entry.deadLetteredAt,
    };
    await this.eventBridge.emit("EscalationRequired", entry.workflowId, payload);
  }

  async replay(workflowId: Uuid): Promise<void> {
    // In a real implementation, this would create a new workflow instance
    // with the same definition but corrected input
    const payload: Json = { originalWorkflowId: workflowId };
    await this.eventBridge.emit("WorkflowReplayRequested", workflowId, payload);
  }
}
