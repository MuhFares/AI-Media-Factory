/**
 * Orchestrator — deterministic, directive-driven orchestration boundary.
 *
 * Responsibilities (contracts and implementation):
 *  - Compile a canonical directive into a deterministic, reusable plan.
 *  - Validate rather than guess: unknown directives, unknown options, empty
 *    directives and empty contexts are rejected, never silently coerced.
 *  - `stub()` returns a cohesive, non-executing scaffold (no executor, no run).
 *  - `produce()` requires an explicit AgentExecutorPort and defers execution to
 *    the Workflow Engine (CollaborationRunner), reusing its provenance checks.
 *  - Agent existence is validated through `RegistryLookup.has()` only — no
 *    capability discovery and no dependency on any concrete agent.
 *
 * Dependency boundary: Orchestrator → Workflow Engine → AgentExecutorPort.
 * The Orchestrator never imports a concrete agent.
 */

import type { AgentExecutorPort, Json, WorkflowContext } from "@ai-media-factory/shared";
import { CollaborationRunner, type CollaborationRunResult } from "@ai-media-factory/workflow-engine";
import {
  DIRECTIVE_TEMPLATES,
  isDirective,
  listAgents,
  listOutputs,
  makeStages,
} from "./templates.js";
import type {
  OrchestratorDirective,
  OrchestratorOptions,
  OrchestratorPlan,
  RegistryLookup,
} from "./types.js";

const OPTION_KEYS = new Set<string>(["timeoutSeconds", "maxAttempts"]);

export interface OrchestratorDeps {
  /** Optional registry used to validate agent existence during planning. */
  readonly registry?: RegistryLookup;
  /** Required for `produce()`; ignored by `stub()`. */
  readonly executor?: AgentExecutorPort;
}

export class Orchestrator {
  constructor(private readonly deps: OrchestratorDeps = {}) {}

  /**
   * Resolve a canonical directive into a non-executing plan. Deterministic:
   * identical directive + options produce an identical plan each call.
   */
  stub(directive: OrchestratorDirective, options?: OrchestratorOptions): OrchestratorPlan {
    return this.prepare(directive, options);
  }

  /**
   * Resolve a canonical directive into an executable plan bound to the caller's
   * workflow identity. Requires a valid context.
   */
  plan(directive: OrchestratorDirective, context: WorkflowContext, options?: OrchestratorOptions): OrchestratorPlan {
    this.assertContext(context);
    return { ...this.prepare(directive, options), workflowId: context.workflowId, correlationId: context.correlationId };
  }

  /**
   * Execute a directive end-to-end. Requires an injected AgentExecutorPort and a
   * valid context; delegates the run to the Workflow Engine, which enforces
   * artifact identity and lineage.
   */
  async produce(directive: OrchestratorDirective, context: WorkflowContext, options?: OrchestratorOptions): Promise<CollaborationRunResult> {
    if (this.deps.executor === undefined) {
      throw new Error("produce() requires an AgentExecutorPort — provide one via the Orchestrator constructor");
    }
    this.assertContext(context);
    const prepared = this.prepare(directive, options);
    return new CollaborationRunner(this.deps.executor).run(prepared.stages, context);
  }

  private prepare(directive: OrchestratorDirective, options?: OrchestratorOptions): OrchestratorPlan {
    this.assertDirective(directive);
    const normalized = this.assertAndNormalizeOptions(options);
    const specs = DIRECTIVE_TEMPLATES[directive];
    const stages = makeStages(specs, normalized);
    const agents = listAgents(specs);
    this.assertRegistered(agents);
    return {
      directive,
      workflowId: null,
      correlationId: null,
      agents,
      outputs: listOutputs(specs),
      stages: Object.freeze(stages),
    };
  }

  private assertDirective(directive: unknown): void {
    if (!isDirective(directive)) {
      throw new Error(`Unsupported directive: ${directive === undefined ? "undefined" : JSON.stringify(directive)}`);
    }
  }

  private assertContext(context: WorkflowContext): void {
    if (context === undefined || context === null) {
      throw new Error("A workflow context is required");
    }
    if (typeof context.workflowId !== "string" || context.workflowId.trim() === "") {
      throw new Error("Context requires a non-empty workflowId");
    }
  }

  private assertAndNormalizeOptions(options: unknown): OrchestratorOptions {
    if (options === undefined) return {};
    if (options === null || typeof options !== "object" || Array.isArray(options)) {
      throw new Error("Options must be a plain object of supported keys");
    }
    for (const key of Object.keys(options)) {
      if (!OPTION_KEYS.has(key)) throw new Error(`Unsupported option: ${key}`);
    }
    const candidate = options as Partial<Record<keyof OrchestratorOptions, Json>>;
    const built: Partial<Record<keyof OrchestratorOptions, number>> = {};
    for (const key of ["timeoutSeconds", "maxAttempts"] as const) {
      const raw = candidate[key];
      if (raw === undefined) continue;
      if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
        throw new Error(`${key} must be a positive integer`);
      }
      built[key] = raw;
    }
    return Object.freeze(built) as OrchestratorOptions;
  }

  private assertRegistered(agents: readonly string[]): void {
    if (this.deps.registry === undefined) return;
    for (const id of agents) {
      if (!this.deps.registry.has(id)) throw new Error(`Agent not registered: ${id}`);
    }
  }
}