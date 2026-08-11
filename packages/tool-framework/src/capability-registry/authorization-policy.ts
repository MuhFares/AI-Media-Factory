/**
 * Explicit authorization policy for capabilities.
 *
 * Authorization is a distinct concern from capability definition and capability
 * execution. A policy maps an AgentId to the exact set of CapabilityIds that the
 * agent is permitted to invoke. There is no implicit authorization and no
 * wildcard expansion: an agent may only invoke a capability it was explicitly
 * granted.
 */

import type { CapabilityId } from "../capabilities.js";

/** A single explicit grant of a capability to an agent. */
export interface CapabilityGrant {
  agentId: string;
  capabilityIds: readonly CapabilityId[];
}

/**
 * Authorization policy boundary. Implementations must be deny-by-default and
 * exact-match only.
 */
export interface AuthorizationPolicy {
  /** Grant an exact capability to an agent. Wildcard patterns are rejected. */
  grant(agentId: string, capabilityId: CapabilityId): void;
  /** Revoke a grant; returns true if a grant was removed. */
  revoke(agentId: string, capabilityId: CapabilityId): boolean;
  /** True only when the agent has an explicit grant for the exact capability. */
  isAuthorized(agentId: string, capabilityId: CapabilityId): boolean;
  /** Capabilities explicitly granted to the agent, in a deterministic order. */
  grantsFor(agentId: string): readonly CapabilityId[];
}

const WILDCARD = /\*/u;

/**
 * Deny-by-default, exact-match authorization policy.
 *
 * - Grants are stored per agent as a set of exact CapabilityIds.
 * - No capability is authorized unless explicitly granted.
 * - Wildcard patterns cannot be granted; attempting to grant one throws.
 */
export class DefaultAuthorizationPolicy implements AuthorizationPolicy {
  private readonly grants = new Map<string, Set<CapabilityId>>();

  grant(agentId: string, capabilityId: CapabilityId): void {
    if (typeof agentId !== "string" || agentId.length === 0) {
      throw new Error("AuthorizationPolicy: agentId must be a non-empty string");
    }
    this.assertExact(capabilityId);
    let agentGrants = this.grants.get(agentId);
    if (agentGrants === undefined) {
      agentGrants = new Set<CapabilityId>();
      this.grants.set(agentId, agentGrants);
    }
    agentGrants.add(capabilityId);
  }

  revoke(agentId: string, capabilityId: CapabilityId): boolean {
    const agentGrants = this.grants.get(agentId);
    if (agentGrants === undefined) return false;
    const removed = agentGrants.delete(capabilityId);
    if (agentGrants.size === 0) {
      this.grants.delete(agentId);
    }
    return removed;
  }

  isAuthorized(agentId: string, capabilityId: CapabilityId): boolean {
    const agentGrants = this.grants.get(agentId);
    if (agentGrants === undefined) return false;
    return agentGrants.has(capabilityId);
  }

  grantsFor(agentId: string): readonly CapabilityId[] {
    const agentGrants = this.grants.get(agentId);
    if (agentGrants === undefined) return [];
    return Array.from(agentGrants).sort();
  }

  private assertExact(capabilityId: CapabilityId): void {
    if (typeof capabilityId !== "string" || capabilityId.length === 0) {
      throw new Error("AuthorizationPolicy: capabilityId must be a non-empty string");
    }
    if (WILDCARD.test(capabilityId)) {
      throw new Error(`AuthorizationPolicy: wildcard grants are not permitted: ${capabilityId}`);
    }
  }
}
