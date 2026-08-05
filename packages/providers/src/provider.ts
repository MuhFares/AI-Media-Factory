/**
 * Provider entry point + shared adapter scaffolding.
 *
 * Re-exports the canonical `LlmProvider` contract (owned by `./core/provider`)
 * and provides an abstract `BaseLlmProvider` that concrete adapters
 * (OpenRouter, and future OpenAI / Anthropic / Gemini / DeepSeek / Mistral /
 * Ollama) extend. The base captures cross-adapter concerns — timeout,
 * capability lookup, health bookkeeping — without embedding any vendor-specific
 * logic, preserving runtime/provider separation and future extensibility.
 */

export type { LlmProvider } from './core/provider.js';

import type { LlmProvider } from './core/provider.js';
import type { ProviderId, ModelId } from './core/common.js';
import type {
  GenerateRequest,
  GenerateResponse,
  StreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
} from './core/request.js';
import type { ModelCapabilities } from './core/capabilities.js';
import type { HealthState } from './observability/health.js';

/** A tiny structured logging hook adapters can call. No transport assumptions. */
export interface ProviderLogger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
}

/** A logger that discards everything — the safe default. */
export const noopLogger: ProviderLogger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/**
 * Abstract base for provider adapters.
 *
 * Concrete adapters implement the vendor-specific transport in
 * `generate` / `stream` / `embed` / `describe` / `supports` / `probeHealth`.
 * The base owns nothing vendor-specific; it only provides shared health-state
 * bookkeeping and a logger handle.
 */
export abstract class BaseLlmProvider implements LlmProvider {
  abstract readonly id: ProviderId;

  protected readonly logger: ProviderLogger;

  private lastHealth: HealthState = {
    status: 'healthy',
    circuitOpen: false,
    detail: null,
    observedAt: new Date(0).toISOString(),
  };

  constructor(logger: ProviderLogger = noopLogger) {
    this.logger = logger;
  }

  abstract supports(model: ModelId): boolean;
  abstract describe(model: ModelId): ModelCapabilities | null;
  abstract generate(request: GenerateRequest, signal: AbortSignal): Promise<GenerateResponse>;
  abstract stream(request: GenerateRequest, signal: AbortSignal): AsyncIterable<StreamChunk>;
  abstract embed(request: EmbeddingRequest, signal: AbortSignal): Promise<EmbeddingResponse>;

  /** Adapters implement the actual probe; the base records + returns the state. */
  protected abstract probeHealth(): Promise<HealthState>;

  async health(): Promise<HealthState> {
    try {
      this.lastHealth = await this.probeHealth();
    } catch (error) {
      this.lastHealth = {
        status: 'unavailable',
        circuitOpen: true,
        detail: error instanceof Error ? error.message : String(error),
        observedAt: new Date().toISOString(),
      };
    }
    return this.lastHealth;
  }

  /** Most recent observed health without re-probing. */
  protected currentHealth(): HealthState {
    return this.lastHealth;
  }
}
