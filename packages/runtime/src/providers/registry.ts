/**
 * Provider registry binding.
 * ARCHITECTURE ONLY — declarations, no logic.
 *
 * The canonical ProviderRegistry, ModelRegistry, and Router live in
 * `@ai-media-factory/providers`. The runtime does not define its own. The
 * earlier `ProviderSelector` concept here is SUPERSEDED by the provider
 * layer's `Router`, which does capability + cost + latency aware selection
 * with cross-vendor fallback. This module re-exports the canonical contracts
 * for the runtime executor's internal use.
 */

export type {
  ProviderRegistry,
  ModelRegistry,
  ModelDescriptor,
  Router,
  RoutingRequest,
  RoutingDecision,
} from "@ai-media-factory/providers";
