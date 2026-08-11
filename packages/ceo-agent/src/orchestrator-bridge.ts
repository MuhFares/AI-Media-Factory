/**
 * Orchestrator bridge — the only place an ExecutiveDirective is forwarded to the
 * existing Orchestrator. CEO → ExecutiveDirective → Orchestrator.plan()/produce().
 *
 * These are thin adapters: they do not own execution, do not create an alternate
 * path, and reuse the Orchestrator's single CollaborationRunner path. workflowId
 * and correlationId are taken verbatim from the caller-supplied target so
 * identity propagates unchanged.
 */

import type { Json, Uuid, WorkflowContext } from "@ai-media-factory/shared";
import { Orchestrator, type OrchestratorDirective, type OrchestratorPlan } from "@ai-media-factory/orchestrator";
import type { CollaborationRunResult } from "@ai-media-factory/workflow-engine";
import type { ExecutiveDirective } from "./types.js";

export function toOrchestratorDirective(directive: ExecutiveDirective): OrchestratorDirective {
  return directive.workflowIntent;
}

export interface ExecutiveRunTarget {
  readonly workflowId: Uuid;
  readonly correlationId?: string;
  readonly brandId?: string | null;
  readonly data?: Record<string, Json>;
}

/** Build a context carrying the directive objective while preserving identity. */
export function executiveContext(directive: ExecutiveDirective, target: ExecutiveRunTarget): WorkflowContext {
  return {
    workflowId: target.workflowId,
    correlationId: target.correlationId ?? null,
    brandId: target.brandId ?? null,
    outputs: {},
    data: { ...(target.data ?? {}), objective: directive.objective },
  };
}

/** Forward a directive to the existing Orchestrator.plan() (non-executing). */
export function planExecutive(orchestrator: Orchestrator, directive: ExecutiveDirective, context: WorkflowContext): OrchestratorPlan {
  return orchestrator.plan(toOrchestratorDirective(directive), context);
}

/** Forward a directive to the existing Orchestrator.produce() (execute the plan). */
export function produceExecutive(orchestrator: Orchestrator, directive: ExecutiveDirective, context: WorkflowContext): Promise<CollaborationRunResult> {
  return orchestrator.produce(toOrchestratorDirective(directive), context);
}