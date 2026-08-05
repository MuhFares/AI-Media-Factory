/**
 * Model registry (req #3): the catalog of models + capabilities + cost/latency.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * Populated from configs/models. Agents reference logical tiers; the registry
 * resolves a tier to concrete candidate models across providers.
 */

import type { ProviderId, ModelId } from "../core/common.js";
import type { Capability, ModelCapabilities } from "../core/capabilities.js";

/** One catalog entry: a concrete model on a concrete provider. */
export interface ModelDescriptor {
  model: ModelId;
  provider: ProviderId;
  capabilities: ModelCapabilities;
}

export interface ModelRegistry {
  register(descriptor: ModelDescriptor): void;
  /** Resolve a logical tier (e.g. "language-tier-large") to candidate models. */
  resolveTier(tier: string): ModelDescriptor[];
  /** All models that support every required capability. */
  filterByCapabilities(required: Capability[]): ModelDescriptor[];
  describe(model: ModelId): ModelDescriptor | null;
  all(): ModelDescriptor[];
}
