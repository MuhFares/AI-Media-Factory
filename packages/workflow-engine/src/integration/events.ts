/**
 * Event Bus integration (req #17).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * The workflow engine coordinates via events; it never calls an agent directly.
 * An AgentStep is dispatched as an event and its completion event advances the
 * workflow. Mirrors the Orchestrator behavior.
 */

import type { Json, Uuid } from "../core/common.js";

/** Events the engine consumes to drive workflows. */
export type InboundEventType =
  | "ExecutiveDirective"     // trigger
  | "ScheduledTrigger"
  | "StepCompleted"          // any *Finished / QAReviewed / PublishApproved ...
  | "DeadLettered";

/** Events the engine emits. */
export type OutboundEventType =
  | "WorkflowStarted"
  | "WorkflowSucceeded"
  | "WorkflowFailed"
  | "WorkflowCancelled"
  | "WorkflowReplayRequested"
  | "CheckpointCreated"
  | "EscalationRequired"
  | "TaskDispatched";        // drives each AgentStep

export interface WorkflowEventBridge {
  /** Subscribe to inbound events that trigger/advance workflows. */
  onInbound(type: InboundEventType, handler: (event: Json) => Promise<void>): void;
  /** Emit an outbound workflow/step event to the bus. */
  emit(type: OutboundEventType, workflowId: Uuid, payload: Json): Promise<void>;
}

// Re-export for runtime use
export type { Json, Uuid } from "../core/common.js";
