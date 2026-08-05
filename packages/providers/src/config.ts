/**
 * Provider Layer — implementation configuration.
 *
 * This module owns the CONCRETE model catalog and runtime configuration for
 * the provider layer implementation. Vendor-neutral contracts live in
 * `./core/*` and remain the single source of truth for provider abstractions;
 * the types here (`ModelConfig`, `ProviderConfig`) are implementation details
 * of the catalog, not part of the provider contract surface.
 */

import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '../../../');
loadEnv({ path: resolve(__dirname, '../../../.env') });

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
  /** Request timeout in milliseconds. */
  timeoutMs: number;
  /** Maximum number of retry attempts */
  maxRetries: number;
  /** Default model to use when none specified */
  defaultModel: string;
  /** Fallback model when the primary is unavailable */
  fallbackModel: string;
  /** Enable request/response logging */
  enableLogging: boolean;
  /** Maximum tokens per request */
  maxTokensPerRequest: number;
  /** Default temperature */
  defaultTemperature: number;
  /** Optional attribution headers required by OpenRouter. */
  referer?: string;
  title?: string;
}

export const MODEL_CATALOG: Record<string, ModelConfig> = {
  // ---- Free tier models (current as of 2025-08-05 from OpenRouter API) ----
  'google/gemma-4-26b-a4b-it:free': {
    id: 'google/gemma-4-26b-a4b-it:free',
    name: 'Gemma 4 26B (Free)',
    contextLength: 8192,
    maxOutputTokens: 4096,
    pricing: { prompt: 0, completion: 0 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'free',
  },
  'google/gemma-4-31b-it:free': {
    id: 'google/gemma-4-31b-it:free',
    name: 'Gemma 4 31B (Free)',
    contextLength: 8192,
    maxOutputTokens: 4096,
    pricing: { prompt: 0, completion: 0 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'free',
  },
  'openai/gpt-oss-20b:free': {
    id: 'openai/gpt-oss-20b:free',
    name: 'GPT-OSS 20B (Free)',
    contextLength: 131072,
    maxOutputTokens: 4096,
    pricing: { prompt: 0, completion: 0 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'free',
  },
  'nvidia/nemotron-3-nano-30b-a3b:free': {
    id: 'nvidia/nemotron-3-nano-30b-a3b:free',
    name: 'Nemotron 3 Nano 30B (Free)',
    contextLength: 32768,
    maxOutputTokens: 4096,
    pricing: { prompt: 0, completion: 0 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'free',
  },
  'nvidia/nemotron-3-ultra-550b-a55b:free': {
    id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'Nemotron 3 Ultra 550B (Free)',
    contextLength: 131072,
    maxOutputTokens: 4096,
    pricing: { prompt: 0, completion: 0 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'free',
  },
  'nvidia/nemotron-3-super-120b-a12b:free': {
    id: 'nvidia/nemotron-3-super-120b-a12b:free',
    name: 'Nemotron 3 Super 120B (Free)',
    contextLength: 131072,
    maxOutputTokens: 4096,
    pricing: { prompt: 0, completion: 0 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'free',
  },
  'nvidia/nemotron-3-nano-12b-v2-vl:free': {
    id: 'nvidia/nemotron-3-nano-12b-v2-vl:free',
    name: 'Nemotron 3 Nano 12B VL (Free)',
    contextLength: 32768,
    maxOutputTokens: 4096,
    pricing: { prompt: 0, completion: 0 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: true },
    tier: 'free',
  },
  'nvidia/nemotron-3-nano-9b-v2:free': {
    id: 'nvidia/nemotron-3-nano-9b-v2:free',
    name: 'Nemotron 3 Nano 9B (Free)',
    contextLength: 32768,
    maxOutputTokens: 4096,
    pricing: { prompt: 0, completion: 0 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'free',
  },
  'cohere/north-mini-code:free': {
    id: 'cohere/north-mini-code:free',
    name: 'Cohere North Mini Code (Free)',
    contextLength: 4096,
    maxOutputTokens: 4096,
    pricing: { prompt: 0, completion: 0 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'free',
  },
  'inclusionai/ling-3.0-flash:free': {
    id: 'inclusionai/ling-3.0-flash:free',
    name: 'Ling 3.0 Flash (Free)',
    contextLength: 8192,
    maxOutputTokens: 4096,
    pricing: { prompt: 0, completion: 0 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'free',
  },
  'poolside/laguna-s-2.1:free': {
    id: 'poolside/laguna-s-2.1:free',
    name: 'Poolside Laguna S 2.1 (Free)',
    contextLength: 8192,
    maxOutputTokens: 4096,
    pricing: { prompt: 0, completion: 0 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'free',
  },
  'poolside/laguna-xs-2.1:free': {
    id: 'poolside/laguna-xs-2.1:free',
    name: 'Poolside Laguna XS 2.1 (Free)',
    contextLength: 8192,
    maxOutputTokens: 4096,
    pricing: { prompt: 0, completion: 0 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: false },
    tier: 'free',
  },

  // ---- Cheap models ----
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

  // Standard models
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
  // Premium models
  'openai/gpt-4o': {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    contextLength: 128000,
    maxOutputTokens: 16384,
    pricing: { prompt: 2.50, completion: 10.00 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: true },
    tier: 'premium',
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
  'anthropic/claude-3.5-sonnet': {
    id: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet',
    contextLength: 200000,
    maxOutputTokens: 8192,
    pricing: { prompt: 3.00, completion: 15.00 },
    capabilities: { streaming: true, structuredOutput: true, functionCalling: true, vision: true },
    tier: 'premium',
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
};

function readEnv(name: string): string | undefined {
  return process.env[name];
}

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
    defaultModel: readEnv('OPENROUTER_DEFAULT_MODEL') ?? 'google/gemma-4-31b-it:free',
    fallbackModel: readEnv('OPENROUTER_FALLBACK_MODEL') ?? 'openai/gpt-oss-20b:free',
    enableLogging: readEnv('OPENROUTER_ENABLE_LOGGING') === 'true',
    maxTokensPerRequest: Number.parseInt(readEnv('OPENROUTER_MAX_TOKENS') ?? '4096', 10),
    defaultTemperature: Number.parseFloat(readEnv('OPENROUTER_DEFAULT_TEMPERATURE') ?? '0.7'),
    referer: readEnv('OPENROUTER_REFERER'),
    title: readEnv('OPENROUTER_TITLE') ?? 'AI Media Factory',
  };
}

export const providerConfig = loadProviderConfig();