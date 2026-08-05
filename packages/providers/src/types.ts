/**
 * @deprecated — import directly from `./core/common.js`, `./core/request.js`,
 * or `./core/capabilities.js`. This shim exists only to avoid breaking any
 * consumer that previously imported from `./types`.
 *
 * The canonical types for the provider layer are:
 *   ProviderId, ModelId, Json          → ./core/common.js
 *   GenerateRequest, GenerateResponse,
 *   StreamChunk, Message, Usage, …     → ./core/request.js
 *   Capability, ModelCapabilities      → ./core/capabilities.js
 *   LlmProvider                        → ./core/provider.js
 *   ProviderError, ProviderErrorKind   → ./core/errors.js
 *   HealthState, HealthMonitor         → ./observability/health.js
 *
 * Implementation-layer types (catalog-specific):
 *   ModelConfig, ModelPricing,
 *   ModelCapabilityFlags, ModelTier,
 *   ProviderConfig                     → ./config.js
 *   ModelFilter, ModelSelectionOptions → ./models.js
 *   RoutingOptions, RoutingResult      → ./router.js
 */

export type { ProviderId, ModelId, Json } from './core/common.js';
export type {
  ContentPart,
  Message,
  ToolDef,
  ResponseFormat,
  GenerateRequest,
  GenerateResponse,
  StreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  Usage,
  ToolCall,
} from './core/request.js';
export type { Capability, ModelCapabilities } from './core/capabilities.js';
export type { LlmProvider } from './core/provider.js';
export type { ProviderError, ProviderErrorKind } from './core/errors.js';
export type { HealthState, HealthStatus, HealthMonitor } from './observability/health.js';
export type {
  ModelConfig,
  ModelPricing,
  ModelCapabilityFlags,
  ModelTier,
  ProviderConfig,
} from './config.js';
export type { ModelFilter, ModelSelectionOptions, SelectionStrategy } from './models.js';
export type { RoutingOptions, RoutingResult, RoutingStrategy } from './router.js';
