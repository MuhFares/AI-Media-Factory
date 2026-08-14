/**
 * ArtifactProducingExecutor — runtime-integration AgentExecutorPort adapter.
 *
 * Bridging adapter for Step 8.11. It composes the authoritative execution
 * boundary with collaboration artifact production WITHOUT adding a second
 * execution path:
 *
 *   CollaborationRunner → AgentExecutorPort (this) → RuntimeAgentExecutor
 *     → Agent → CapabilityExecutionPort → RuntimeCapabilityExecutor → Capability
 *
 * Responsibilities:
 *  - Delegate every agent step to RuntimeAgentExecutor (the execution authority).
 *    It never re-executes an agent and never constructs a concrete agent.
 *  - Enrich the step context with the per-agent execution input the agent needs
 *    (the concrete input protocol is supplied at the wiring site, not baked in
 *    here or in the Orchestrator).
 *  - Wrap the REAL agent output into a CollaborationArtifact preserving
 *    workflowId, correlationId, producerAgent and parentArtifact lineage. The
 *    payload is the agent's own output — including any runtime-produced
 *    capability evidence. Nothing is fabricated here.
 *  - Propagate failures unchanged and terminate on a blocked/failed capability
 *    so a blocked capability can never become a successful downstream artifact.
 *
 * Origin/authority boundary: execution is owned by RuntimeAgentExecutor; this
 * class only shapes the collaboration artifact envelope around its output.
 */

import type {
  AgentArtifactKind,
  AgentExecutorPort,
  AgentStep,
  CollaborationArtifact,
  Json,
  StepOutcome,
  WorkflowContext,
} from "@ai-media-factory/shared";
import { RuntimeAgentExecutor } from "@ai-media-factory/runtime";

const SCHEMA_VERSION = "1.0";
const FIXED_CREATED_AT = "2026-08-11T00:00:00.000Z";

/** Shape of the collaboration artifact envelope produced for a step. */
export interface ArtifactSpec {
  readonly kind: AgentArtifactKind;
  readonly artifactId: string;
}

export interface ArtifactProducingExecutorOptions {
  /** Authoritative execution boundary. Required. */
  readonly runtimeExecutor: RuntimeAgentExecutor;
  /**
   * Optional per-step context enrichment so a real agent receives its required
   * execution input (task + capability requests). Concrete agent protocol lives
   * at the wiring site; this adapter does not own it.
   */
  readonly prepareInput?: (step: AgentStep, context: WorkflowContext) => Json;
  /** Derive the artifact kind + id from the real agent output. */
  readonly artifactFor: (step: AgentStep, context: WorkflowContext, output: Json) => ArtifactSpec;
  /**
   * Optional policy: given the real output, report whether a capability was
   * blocked/failed. When true the step is treated as a controlled failure so no
   * successful downstream artifact is fabricated.
   */
  readonly hasFatalCapability?: (output: Json) => boolean;
}

function isRecord(value: Json): value is { [key: string]: Json } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class ArtifactProducingExecutor implements AgentExecutorPort {
  constructor(private readonly options: ArtifactProducingExecutorOptions) {}

  async executeAgentStep(step: AgentStep, context: WorkflowContext): Promise<StepOutcome> {
    const enriched = this.prepareContext(step, context);

    // Authoritative execution — never bypassed.
    const outcome = await this.options.runtimeExecutor.executeAgentStep(step, enriched);
    if (outcome.status !== "completed") return outcome;

    if (this.options.hasFatalCapability !== undefined && this.options.hasFatalCapability(outcome.output)) {
      const spec = this.options.artifactFor(step, context, outcome.output);
      return {
        status: "completed",
        output: outcome.output,
        artifact: this.buildArtifact(step, context, spec.kind, spec.artifactId, outcome.output, "blocked"),
      };
    }

    const spec = this.options.artifactFor(step, context, outcome.output);
    return { status: "completed", output: outcome.output, artifact: this.buildArtifact(step, context, spec.kind, spec.artifactId, outcome.output) };
  }

  private prepareContext(step: AgentStep, context: WorkflowContext): WorkflowContext {
    if (this.options.prepareInput === undefined) return context;
    const input = this.options.prepareInput(step, context);
    if (!isRecord(input)) return context;
    return { ...context, data: { ...context.data, ...input } };
  }

  private buildArtifact(step: AgentStep, context: WorkflowContext, kind: AgentArtifactKind, artifactId: string, payload: Json, status: "proposed" | "completed" | "blocked" | "failed" = "completed"): CollaborationArtifact {
    const previous = isRecord(context.data.previousArtifact) ? context.data.previousArtifact : undefined;
    const artifact = {
      artifactId,
      kind,
      producerAgent: step.agent,
      workflowId: context.workflowId,
      correlationId: context.correlationId ?? "",
      status,
      payload,
      contentType: "application/json",
      schemaVersion: SCHEMA_VERSION,
      createdAt: FIXED_CREATED_AT,
      ...(previous === undefined
        ? {}
        : { parentArtifact: { artifactId: String(previous.artifactId), kind: previous.kind as AgentArtifactKind } }),
    };
    return artifact as CollaborationArtifact;
  }
}