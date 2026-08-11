/**
 * Deterministic executive decision policy.
 *
 * The policy maps a supported workflow intent to the existing Orchestrator
 * templates, restricts requested stages to agents present in the registry lookup
 * (never inventing agents), and validates every boundary (objective, intent,
 * priority, constraints) — failing safely rather than guessing.
 */

import { DIRECTIVE_TEMPLATES } from "@ai-media-factory/orchestrator";
import type { RegistryLookup } from "@ai-media-factory/orchestrator";
import type {
  Priority,
  WorkflowIntent,
} from "./types.js";

const PRIORITIES: readonly Priority[] = ["low", "medium", "high", "urgent"];
const CONSTRAINT_KEYS: readonly string[] = ["requiredCapabilities", "forbiddenCapabilities", "maxStages", "deterministic"];

export function isWorkflowIntent(value: unknown): value is WorkflowIntent {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DIRECTIVE_TEMPLATES, value);
}

export function templateAgentsFor(intent: WorkflowIntent): readonly string[] {
  return DIRECTIVE_TEMPLATES[intent].map((spec) => spec.agent);
}

export function validateObjective(objective: unknown): asserts objective is string {
  if (typeof objective !== "string" || objective.trim() === "") {
    throw new Error("Objective is required and must be a non-empty string");
  }
}

export function validatePriority(priority: unknown): asserts priority is Priority {
  if (typeof priority !== "string" || !PRIORITIES.includes(priority as Priority)) {
    throw new Error(`Invalid priority: ${JSON.stringify(priority)}`);
  }
}

export function isRecord(value: JsonLike): value is { [key: string]: unknown } {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type JsonLike = unknown;

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function normalizeConstraints(raw: unknown): Readonly<Record<string, unknown>> {
  if (raw === undefined) return {};
  if (!isRecord(raw)) throw new Error("Constraints must be a plain object");
  for (const key of Object.keys(raw)) {
    if (!CONSTRAINT_KEYS.includes(key)) throw new Error(`Unsupported constraint: ${key}`);
  }
  if (raw.requiredCapabilities !== undefined && !isStringArray(raw.requiredCapabilities)) throw new Error("requiredCapabilities must be an array of strings");
  if (raw.forbiddenCapabilities !== undefined && !isStringArray(raw.forbiddenCapabilities)) throw new Error("forbiddenCapabilities must be an array of strings");
  if (raw.maxStages !== undefined && (typeof raw.maxStages !== "number" || !Number.isInteger(raw.maxStages) || raw.maxStages < 1)) throw new Error("maxStages must be a positive integer");
  if (raw.deterministic !== undefined && typeof raw.deterministic !== "boolean") throw new Error("deterministic must be a boolean");
  return raw as Readonly<Record<string, unknown>>;
}

export function assertAgentsAvailable(agents: readonly string[], registry: RegistryLookup | undefined): void {
  if (registry === undefined) return;
  for (const agentId of agents) {
    if (!registry.has(agentId)) throw new Error(`Unavailable agent: ${agentId}`);
  }
}