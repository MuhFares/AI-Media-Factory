/**
 * Capability registry and resolver.
 *
 * The registry is the single source of truth for which capabilities exist and
 * which agents are permitted to invoke them. It separates three concerns that
 * the execution boundary keeps distinct:
 *
 *   1. Capability definition  -> CapabilityDescriptor (name, description, schemas)
 *   2. Authorization policy   -> AuthorizationPolicy (AgentId -> exact CapabilityIds)
 *   3. Capability execution   -> CapabilityExecutorPort (NOT used by this module)
 *
 * The registry never executes a capability. It only resolves definitions and
 * answers authorization questions. Execution always flows through the runtime
 * boundary (RuntimeCapabilityExecutor).
 */

import type {
  CapabilityDescriptor,
  CapabilityId,
  CapabilityResolver,
} from "../capabilities.js";
import type { JsonSchema } from "../core/common.js";
import type {
  AuthorizationPolicy,
  CapabilityGrant,
} from "./authorization-policy.js";
import { DefaultAuthorizationPolicy } from "./authorization-policy.js";

export interface CapabilityRegistry extends CapabilityResolver {
  /** Register a capability definition. Duplicate capabilityIds are rejected. */
  register(descriptor: CapabilityDescriptor): void;
  /** Remove a capability definition; returns true when one was removed. */
  unregister(capabilityId: CapabilityId): boolean;
  /** All registered definitions in insertion order. */
  list(): readonly CapabilityDescriptor[];
  /** The authorization policy backing this registry. */
  getAuthorizationPolicy(): AuthorizationPolicy;
}

export interface CapabilityRegistryOptions {
  policy?: AuthorizationPolicy;
}

const EMPTY_SCHEMA: JsonSchema = { type: "object" };

function isJsonSchema(value: unknown): value is JsonSchema {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertDescriptor(descriptor: CapabilityDescriptor): void {
  if (descriptor === null || typeof descriptor !== "object") {
    throw new Error("CapabilityRegistry: descriptor must be an object");
  }
  if (typeof descriptor.capabilityId !== "string" || descriptor.capabilityId.length === 0) {
    throw new Error("CapabilityRegistry: capabilityId must be a non-empty string");
  }
  if (typeof descriptor.description !== "string" || descriptor.description.length === 0) {
    throw new Error("CapabilityRegistry: description must be a non-empty string");
  }
  if (!isJsonSchema(descriptor.inputSchema)) {
    throw new Error("CapabilityRegistry: inputSchema must be an object");
  }
  if (!isJsonSchema(descriptor.outputSchema)) {
    throw new Error("CapabilityRegistry: outputSchema must be an object");
  }
}

/**
 * Default capability registry. Definitions are stored in insertion order for
 * deterministic listing. Authorization is delegated to an injected policy and
 * additionally requires the capability to be registered (deny-by-default: a
 * capability must both exist and be granted before it is authorized).
 */
export class DefaultCapabilityRegistry implements CapabilityRegistry {
  private readonly definitions = new Map<CapabilityId, CapabilityDescriptor>();
  private readonly policy: AuthorizationPolicy;

  constructor(options: CapabilityRegistryOptions = {}) {
    this.policy = options.policy ?? new DefaultAuthorizationPolicy();
  }

  register(descriptor: CapabilityDescriptor): void {
    assertDescriptor(descriptor);
    if (this.definitions.has(descriptor.capabilityId)) {
      throw new Error(`CapabilityRegistry: capability already registered: ${descriptor.capabilityId}`);
    }
    this.definitions.set(descriptor.capabilityId, { ...descriptor });
  }

  unregister(capabilityId: CapabilityId): boolean {
    return this.definitions.delete(capabilityId);
  }

  list(): readonly CapabilityDescriptor[] {
    return Array.from(this.definitions.values()).map((descriptor) => ({ ...descriptor }));
  }

  resolve(capabilityId: CapabilityId): CapabilityDescriptor | null {
    const descriptor = this.definitions.get(capabilityId);
    return descriptor === undefined ? null : { ...descriptor };
  }

  isAuthorized(agentId: string, capabilityId: CapabilityId): boolean {
    if (!this.definitions.has(capabilityId)) return false;
    return this.policy.isAuthorized(agentId, capabilityId);
  }

  getAuthorizationPolicy(): AuthorizationPolicy {
    return this.policy;
  }
}

export interface CreateCapabilityRegistryOptions {
  /** Capability definitions to register, in deterministic order. */
  capabilities?: readonly CapabilityDescriptor[];
  /** Explicit grants applied in deterministic order. */
  grants?: readonly CapabilityGrant[];
  policy?: AuthorizationPolicy;
}

/**
 * Deterministically initialize a capability registry and its authorization
 * policy from plain configuration. Registration and grants are applied in the
 * order provided, so identical input always produces identical state.
 */
export function createCapabilityRegistry(
  options: CreateCapabilityRegistryOptions = {},
): CapabilityRegistry {
  const registry = new DefaultCapabilityRegistry({ policy: options.policy });
  for (const descriptor of options.capabilities ?? []) {
    registry.register(descriptor);
  }
  for (const grant of options.grants ?? []) {
    for (const capabilityId of grant.capabilityIds) {
      registry.getAuthorizationPolicy().grant(grant.agentId, capabilityId);
    }
  }
  return registry;
}
