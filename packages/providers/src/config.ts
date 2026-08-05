/**
 * Provider Layer — implementation configuration.
 *
 * This module owns the CONCRETE model catalog and runtime configuration for
 * the provider layer implementation. Vendor-neutral contracts live in
 * `./core/*` and remain the single source of truth for provider abstractions;
 * the types here (`ModelConfig`, `ProviderConfig`) are implementation details
 * of the catalog, not part of the provider contract surface.
 */

/** Per-1M-token pricing for a concrete model. */
export interface ModelPricing {
  /** USD per 1M input (prompt) tokens. */
  prompt: number;
  /** USD per 1M output (completion) tokens. */
  completion: number;
}

/** Concrete capability flags for a catalog model. */
export interface ModelCapabilityFlags {
  streaming: boolean;
  structuredOutput: boolean;
  functionCalling: boolean;
  vision: boolean;
}

/** Cost tier used by cost-aware routing. */
export type ModelTier = 'free' | 'cheap' | 'standard' | 'premium';

/** A concrete model entry in the catalog. */
export interface ModelConfig {
  id: string;
  name: string;
  contextLength: number;
  maxOutputTokens: number;
  pricing: ModelPricing;
  capabilities: ModelCapabilityFlags;
  tier: ModelTier;
}

/** Runtime configuration for the OpenRouter transport. */
export interface ProviderConfig {
  /** OpenRouter API key (from environment). */
  apiKey: string;
  /** Base URL for the OpenRouter API. */
  baseUrl: string;
  /** Per-request timeout in milliseconds. */
  timeoutMs: number;
  /** Maximum retry attempts for transient failures. */
  maxRetries: number;
  /** Default model when a caller does not specify one. */
  defaultModel: string;
  /** Fallback model when the primary is unavailable. */
  fallbackModel: string;
  /** Emit structured logs for requests/responses. */
  enableLogging: boolean;
  /** Ceiling for output tokens per request. */
  maxTokensPerRequest: number;
  /** Default sampling temperature. */
  defaultTemperature: number;
  /** Optional attribution headers required by OpenRouter. */
  referer?: string;
  title?: string;
}

/**
 * The concrete model catalog exposed through OpenRouter.
 * Extend this map to register additional models; routing consumes it via
 * the ModelRegistry.
 */
export const MODEL_CATALOG: Record<string, ModelConfig> = {
  // ---- Free tier ----
  'meta-llama/llama-3.1-8b-instruct:free': {
    id: 'meta-llama/llama-3.1-8b-instruct:free',
    name: 'Llama 3.1 8B Instruct (Free)',
    contextLength: 131072,
    maxOutputTokens: 4096,
    pricing: { prompt: 0, completion: 0 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'free',
  },
  'mistralai/mistral-7b-instruct:free': {
    id: 'mistralai/mistral-7b-instruct:free',
    name: 'Mistral 7B Instruct (Free)',
    contextLength: 32768,
    maxOutputTokens: 4096,
    pricing: { prompt: 0, completion: 0 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'free',
  },
  'google/gemma-2-9b-it:free': {
    id: 'google/gemma-2-9b-it:free',
    name: 'Gemma 2 9B IT (Free)',
    contextLength: 8192,
    maxOutputTokens: 4096,
    pricing: { prompt: 0, completion: 0 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'free',
  },

  // ---- Cheap tier ----
  'meta-llama/llama-3.1-8b-instruct': {
    id: 'meta-llama/llama-3.1-8b-instruct',
    name: 'Llama 3.1 8B Instruct',
    contextLength: 131072,
    maxOutputTokens: 4096,
    pricing: { prompt: 0.18, completion: 0.18 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'cheap',
  },
  'mistralai/mistral-7b-instruct': {
    id: 'mistralai/mistral-7b-instruct',
    name: 'Mistral 7B Instruct',
    contextLength: 32768,
    maxOutputTokens: 4096,
    pricing: { prompt: 0.25, completion: 0.25 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'cheap',
  },
  'google/gemma-2-9b-it': {
    id: 'google/gemma-2-9b-it',
    name: 'Gemma 2 9B IT',
    contextLength: 8192,
    maxOutputTokens: 4096,
    pricing: { prompt: 0.20, completion: 0.20 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'cheap',
  },

  // ---- Standard tier ----
  'meta-llama/llama-3.1-70b-instruct': {
    id: 'meta-llama/llama-3.1-70b-instruct',
    name: 'Llama 3.1 70B Instruct',
    contextLength: 131072,
    maxOutputTokens: 4096,
    pricing: { prompt: 0.88, completion: 0.88 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'standard',
  },
  'google/gemini-flash-1.5': {
    id: 'google/gemini-flash-1.5',
    name: 'Gemini Flash 1.5',
    contextLength: 1048576,
    maxOutputTokens: 8192,
    pricing: { prompt: 0.075, completion: 0.30 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: true },
    tier: 'standard',
  },
  'google/gemini-pro-1.5': {
    id: 'google/gemini-pro-1.5',
    name: 'Gemini Pro 1.5',
    contextLength: 2097152,
    maxOutputTokens: 8192,
    pricing: { prompt: 1.25, completion: 5.00 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: true },
    tier: 'standard',
  },
  'openai/gpt-4o-mini': {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    contextLength: 128000,
    maxOutputTokens: 16384,
    pricing: { prompt: 0.15, completion: 0.60 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: true },
    tier: 'standard',
  },
  'anthropic/claude-3-haiku': {
    id: 'anthropic/claude-3-haiku',
    name: 'Claude 3 Haiku',
    contextLength: 200000,
    maxOutputTokens: 4096,
    pricing: { prompt: 0.25, completion: 1.25 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: true },
    tier: 'standard',
  },

  // ---- Premium tier ----
  'openai/gpt-4o': {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    contextLength: 128000,
    maxOutputTokens: 16384,
    pricing: { prompt: 2.50, completion: 10.00 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: true },
    tier: 'premium',
  },
  'mistralai/mistral-large': {
    id: 'mistralai/mistral-large',
    name: 'Mistral Large',
    contextLength: 131072,
    maxOutputTokens: 4096,
    pricing: { prompt: 2.00, completion: 6.00 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'premium',
  },
  'anthropic/claude-3.5-sonnet': {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    contextLength: 200000,
    maxOutputTokens: 8192,
    pricing: { prompt: 3.00, completion: 15.00 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: true },
    tier: 'premium',
  },
};

/** Read an environment variable through the Node process, if present. */
function readEnv(name: string): string | undefined {
  return process.env[name];
}

/**
 * Load provider configuration from the environment.
 * Throws if the required API key is absent.
 */
export function loadProviderConfig(): ProviderConfig {
  const apiKey = readEnv('OPENROUTER_API_KEY');
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable is required');
  }

  return {
    apiKey,
    baseUrl: readEnv('OPENROUTER_BASE_URL') ?? 'https://openrouter.ai/api/v1',
    timeoutMs: Number.parseInt(readEnv('OPENROUTER_TIMEOUT_MS') ?? '60000', 10),
    maxRetries: Number.parseInt(readEnv('OPENROUTER_MAX_RETRIES') ?? '3', 10),
    defaultModel: readEnv('OPENROUTER_DEFAULT_MODEL') ?? 'meta-llama/llama-3.1-8b-instruct:free',
    fallbackModel: readEnv('OPENROUTER_FALLBACK_MODEL') ?? 'mistralai/mistral-7b-instruct:free',
    enableLogging: readEnv('OPENROUTER_ENABLE_LOGGING') === 'true',
    maxTokensPerRequest: Number.parseInt(readEnv('OPENROUTER_MAX_TOKENS') ?? '4096', 10),
    defaultTemperature: Number.parseFloat(readEnv('OPENROUTER_DEFAULT_TEMPERATURE') ?? '0.7'),
    referer: readEnv('OPENROUTER_REFERER'),
    title: readEnv('OPENROUTER_TITLE') ?? 'AI Media Factory',
  };
}
