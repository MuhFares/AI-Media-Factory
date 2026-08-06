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
    await this.eventBridge.emit("EscalationRequired", entry.workflowId, entry as unknown as Json);
  }

  async replay(workflowId: Uuid): Promise<void> {
    // In a real implementation, this would create a new workflow instance
    // with the same definition but corrected input
    await this.eventBridge.emit("WorkflowReplayRequested", workflowId, { originalWorkflowId: workflowId } as Json);
  }
}