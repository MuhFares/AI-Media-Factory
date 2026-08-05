/**
 * @ai-media-factory/providers — public contract surface.
 *
 * Re-exports the vendor-neutral interface/type declarations (from `./core/`,
 * `./routing/`, `./registry/`, `./observability/`, `./resilience/`) that define
 * the unified multi-provider LLM layer, plus the concrete implementation-layer
 * helpers (config, catalog, router) and the OpenRouter adapter.
 *
 * The runtime imports the contracts (LlmProvider, GenerateRequest, etc.) from
 * here and calls generate()/stream()/embed() without knowing which vendor
 * answers. See ./README.md.
 */

// ---- Vendor-neutral contracts (architecture, Sprint 4) ----
export type * from './core/common.js';
export type * from './core/capabilities.js';
export type * from './core/request.js';
export type * from './core/provider.js';
export type * from './core/errors.js';
export type * from './registry/provider-registry.js';
export type * from './registry/model-registry.js';
export type * from './routing/router.js';
export type * from './routing/selection.js';
export type * from './routing/fallback.js';
export type * from './resilience/retry.js';
export type * from './resilience/rate-limiter.js';
export type * from './observability/health.js';
export type * from './observability/metrics.js';
export type * from './observability/cost.js';

// ---- Implementation layer (Sprint 5) ----
export type {
  ModelConfig,
  ModelPricing,
  ModelCapabilityFlags,
  ModelTier,
  ProviderConfig,
} from './config.js';
export { MODEL_CATALOG, loadProviderConfig } from './config.js';

export type { ModelFilter, ModelSelectionOptions, SelectionStrategy } from './models.js';
export { ModelRegistry, modelRegistry } from './models.js';

export type { RoutingOptions, RoutingResult, RoutingStrategy, RoutingCandidate } from './router.js';
export { ModelRouter, modelRouter } from './router.js';

export type { ProviderLogger } from './provider.js';
export { BaseLlmProvider, noopLogger } from './provider.js';

export { OpenRouterProvider } from './openrouter.js';
export { AlibabaProvider } from './alibaba.js';

// Backwards-compat shim for consumers that previously imported from './types'.
export type * from './types.js';
