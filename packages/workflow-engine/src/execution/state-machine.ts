/**
 * Workflow-level state machine (req #3).
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Owns the per-workflow states. Distinct from the runtime's per-turn machine,
 * which runs INSIDE an AgentStep.
 */

import type { WorkflowState, StateTransition, WorkflowStateMachine } from "../core/common.js";

/** Re-export for backward compatibility. */
export type { StateTransition, WorkflowStateMachine } from "../core/common.js";
