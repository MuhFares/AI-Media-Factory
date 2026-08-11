/**
 * CEOAgent — executive decision layer.
 *
 * Consumes an executive objective and produces a validated ExecutiveDirective
 * for the existing Orchestrator. It is a decision layer ONLY: it never executes
 * agents, never executes capabilities, and never accesses tools/files/network.
 *
 * Deterministic: identical input + registry state + clock produce an identical
 * directive (including a deterministically derived directiveId and evidenceId).
 *
 * Dependency boundary: CEOAgent → { shared, orchestrator }. No concrete agents,
 * no runtime, no capability surface, no provider imports.
 */

import type {
  CEOAgentOptions,
  DecisionEvidence,
  ExecutiveDirective,
  ExecutiveObjectiveInput,
  Priority,
  WorkflowIntent,
} from "./types.js";
import {
  assertAgentsAvailable,
  isWorkflowIntent,
  normalizeConstraints,
  templateAgentsFor,
  validateObjective,
  validatePriority,
} from "./policy.js";

const DEFAULT_SOURCE = "executive-registered-policy";

function hashPart(content: string, salt: number): string {
  let hash = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < content.length; i += 1) {
    hash ^= content.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Deterministic, content-derived identifier (stable for identical input). */
export function deriveId(content: string): string {
  return [0, 1, 2, 3].map((salt) => hashPart(content, salt)).join("-");
}

function isRecord(value: unknown): value is { [key: string]: unknown } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export class CEOAgent {
  private readonly registry;
  private readonly clock;
  private readonly decisionSource;

  constructor(private readonly options: CEOAgentOptions = {}) {
    this.registry = options.registry;
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.decisionSource = options.decisionSource ?? DEFAULT_SOURCE;
  }

  decide(request: ExecutiveObjectiveInput): ExecutiveDirective {
    if (!isRecord(request) || request === null) throw new Error("A decision request is required");
    validateObjective(request.objective);

    const intent = request.intent;
    if (!isWorkflowIntent(intent)) throw new Error(`Unsupported workflow intent: ${JSON.stringify(intent)}`);

    const priority = (request.priority ?? "medium") as Priority;
    validatePriority(priority);

    const constraints = normalizeConstraints(request.constraints);

    const templateAgents = templateAgentsFor(intent as WorkflowIntent);
    assertAgentsAvailable(templateAgents, this.registry);

    const seeded = { objective: request.objective, intent, priority, constraints };
    const canonical = JSON.stringify(seeded);

    const createdAt = this.clock();
    const directiveId = deriveId(canonical);
    const evidenceId = deriveId(`${canonical}#decision-evidence`);

    const evidence: DecisionEvidence = {
      kind: "executive_decision",
      evidenceId,
      directiveId,
      objective: request.objective,
      selectedWorkflow: intent as WorkflowIntent,
      selectedAgents: templateAgents,
      decisionSource: this.decisionSource,
      decidedAt: createdAt,
    };

    return {
      directiveId,
      objective: request.objective,
      workflowIntent: intent as WorkflowIntent,
      priority,
      requestedStages: templateAgents,
      constraints,
      createdAt,
      decisionEvidence: evidence,
    };
  }
}

/** Factory function to create a CEOAgent with defaults. */
export function createCEOAgent(options?: CEOAgentOptions): CEOAgent {
  return new CEOAgent(options);
}