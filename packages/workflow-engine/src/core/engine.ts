/**
 * The WorkflowEngine facade — starts and controls workflow instances (req #2).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * The engine OWNS execution state. It calls the Runtime to execute agent steps,
 * the Event Bus to transport events, and the Memory Engine to checkpoint. It
 * never executes an agent, transports an event, or stores memory itself.
 */

import type { Json, Uuid } from "./common";
import type { WorkflowDefinition } from "../model/definition";
import type { WorkflowInstance } from "./instance";
import type { ApprovalDecision } from "../execution/approval";

export interface StartInput {
  definition: WorkflowDefinition;
  trigger: Json;               // the triggering event/payload
  correlationId?: string;
  brandId?: string;
}

export interface WorkflowEngine {
  /** #2 Start a new workflow instance from a definition. */
  start(input: StartInput): Promise<WorkflowInstance>;

  /** #11 Pause a running workflow (checkpoints; in-flight steps finish). */
  pause(workflowId: Uuid, reason: string): Promise<void>;

  /** #10 Resume a paused/crashed workflow from its last checkpoint. */
  resume(workflowId: Uuid): Promise<WorkflowInstance>;

  /** #12 Cancel a workflow (runs compensation for completed steps). */
  cancel(workflowId: Uuid, reason: string): Promise<void>;

  /** #16 Deliver a human approval decision to a gate-blocked workflow. */
  signalApproval(workflowId: Uuid, decision: ApprovalDecision): Promise<void>;

  /** Inspect current state (for monitoring/audit). */
  describe(workflowId: Uuid): Promise<WorkflowInstance | null>;
}
