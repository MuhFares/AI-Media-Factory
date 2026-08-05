/**
 * OpenRouter provider adapter.
 *
 * Implements the `LlmProvider` contract over the OpenRouter unified gateway,
 * which exposes 100+ models from OpenAI, Anthropic, Google, Meta, Mistral,
 * and others through a single OpenAI-compatible API. Credentials come from
 * the environment; the adapter never stores them.
 */

import { BaseLlmProvider, noopLogger } from './provider.js';
import type { ProviderLogger } from './provider.js';
import type { ProviderId, ModelId } from './core/common.js';
import type {
  GenerateRequest,
  GenerateResponse,
  StreamChunk,
  EmbeddingRequest,
  EmbeddingResponse,
  Message,
  ContentPart,
  ToolDef,
} from './core/request.js';
import type { ModelCapabilities } from './core/capabilities.js';
import type { HealthState } from './observability/health.js';
import { loadProviderConfig } from './config.js';
import { modelRegistry } from './models.js';

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
}

interface OpenRouterRequest {
  model: string;
  messages: OpenRouterMessage[];
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string[];
  stream?: boolean;
  response_format?: { type: 'json_object' };
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>;
}

interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenRouterChoice {
  index: number;
  message: { role: 'assistant'; content: string };
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
}

interface OpenRouterResponse {
  id: string;
  model: string;
  choices: OpenRouterChoice[];
  usage: OpenRouterUsage;
  created: number;
}

interface OpenRouterStreamChunk {
  id: string;
  choices: Array<{ index: number; delta: { content?: string }; finish_reason: string | null }>;
  usage?: OpenRouterUsage;
}

export class OpenRouterProvider extends BaseLlmProvider {
  readonly id: ProviderId = 'openrouter';

  private readonly config = loadProviderConfig();

  constructor(logger: ProviderLogger = noopLogger) {
    super(logger);
  }

  supports(model: ModelId): boolean {
    return modelRegistry.get(model) !== undefined;
  }

  describe(model: ModelId): ModelCapabilities | null {
    const config = modelRegistry.get(model);
    if (!config) {
      return null;
    }
    return {
      capabilities: [
        'text',
        ...(config.capabilities.streaming ? (['streaming'] as const) : []),
        ...(config.capabilities.structuredOutput ? (['json_mode'] as const) : []),
        ...(config.capabilities.functionCalling ? (['function_calling'] as const) : []),
        ...(config.capabilities.vision ? (['vision'] as const) : []),
      ],
      contextWindow: config.contextLength,
      costPer1kInputUsd: config.pricing.prompt,
      costPer1kOutputUsd: config.pricing.completion,
      qualityTier: config.tier,
    };
  }

  async generate(request: GenerateRequest, signal: AbortSignal): Promise<GenerateResponse> {
    const startMs = Date.now();

    const body: OpenRouterRequest = {
      model: request.model,
      messages: request.messages.map(this.mapMessage),
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens,
      stream: false,
    };

    if (request.responseFormat?.kind === 'json' || request.responseFormat?.kind === 'json_schema') {
      body.response_format = { type: 'json_object' };
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const response = await this.fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => 'unknown');
      throw new Error(`OpenRouter request failed (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as OpenRouterResponse;
    const choice = data.choices[0];
    if (!choice) {
      throw new Error('OpenRouter returned no choices');
    }

    const text = choice.message.content;
    let output: import('./core/common.js').Json = text;
    if (request.responseFormat?.kind === 'json' || request.responseFormat?.kind === 'json_schema') {
      try {
        output = JSON.parse(text) as import('./core/common.js').Json;
      } catch {
        output = text;
      }
    }

    const latencyMs = Date.now() - startMs;
    const costUsd = modelRegistry.estimateCost(
      request.model,
      data.usage.prompt_tokens,
      data.usage.completion_tokens,
    );

    return {
      output,
      text,
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: data.usage.completion_tokens,
        costUsd,
      },
      provider: this.id,
      model: data.model,
      latencyMs,
      finishReason: choice.finish_reason,
    };
  }

  async *stream(request: GenerateRequest, signal: AbortSignal): AsyncIterable<StreamChunk> {
    const body: OpenRouterRequest = {
      model: request.model,
      messages: request.messages.map(this.mapMessage),
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens,
      stream: true,
    };

    const response = await this.fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => 'unknown');
      throw new Error(`OpenRouter stream failed (${response.status}): ${detail}`);
    }

    if (!response.body) {
      throw new Error('OpenRouter stream: no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') {
            continue;
          }
          if (trimmed.startsWith('data: ')) {
            const json = trimmed.slice(6);
            const chunk = JSON.parse(json) as OpenRouterStreamChunk;
            const delta = chunk.choices[0]?.delta.content;
            if (delta) {
              yield { delta, done: false };
            }
            if (chunk.usage) {
              const costUsd = modelRegistry.estimateCost(
                request.model,
                chunk.usage.prompt_tokens,
                chunk.usage.completion_tokens,
              );
              yield {
                delta: '',
                done: true,
                usage: {
                  inputTokens: chunk.usage.prompt_tokens,
                  outputTokens: chunk.usage.completion_tokens,
                  costUsd,
                },
              };
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  async embed(request: EmbeddingRequest, signal: AbortSignal): Promise<EmbeddingResponse> {
    const response = await this.fetch(`${this.config.baseUrl}/embeddings`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ model: request.model, input: request.input }),
      signal,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => 'unknown');
      throw new Error(`OpenRouter embeddings failed (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
      usage: OpenRouterUsage;
      model: string;
    };

    const costUsd = modelRegistry.estimateCost(request.model, data.usage.prompt_tokens, 0);

    return {
      vectors: data.data.map((d) => d.embedding),
      usage: {
        inputTokens: data.usage.prompt_tokens,
        outputTokens: 0,
        costUsd,
      },
      provider: this.id,
      model: data.model,
    };
  }

  protected async probeHealth(): Promise<HealthState> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await this.fetch(`${this.config.baseUrl}/models`, {
        method: 'GET',
        headers: this.headers(),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return {
          status: 'healthy',
          circuitOpen: false,
          detail: null,
          observedAt: new Date().toISOString(),
        };
      } else {
        return {
          status: 'degraded',
          circuitOpen: false,
          detail: `HTTP ${response.status}`,
          observedAt: new Date().toISOString(),
        };
      }
    } catch (error) {
      return {
        status: 'unavailable',
        circuitOpen: true,
        detail: error instanceof Error ? error.message : String(error),
        observedAt: new Date().toISOString(),
      };
    }
  }

  private mapMessage(msg: Message): OpenRouterMessage {
    if (typeof msg.content === 'string') {
      return { role: msg.role === 'tool' ? 'user' : msg.role, content: msg.content };
    }
    const parts = msg.content.map((part: ContentPart) => {
      if (part.kind === 'text') {
        return { type: 'text' as const, text: part.text };
      } else {
        return { type: 'image_url' as const, image_url: { url: part.url } };
      }
    });
    return { role: msg.role === 'tool' ? 'user' : msg.role, content: parts };
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': this.config.referer ?? 'https://ai-media-factory.local',
      'X-Title': this.config.title ?? 'AI Media Factory',
    };
  }

  private async fetch(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const signal = init.signal
      ? this.combineSignals(init.signal, controller.signal)
      : controller.signal;

    try {
      return await fetch(url, { ...init, signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
    const controller = new AbortController();
    const abort = () => controller.abort();
    a.addEventListener('abort', abort, { once: true });
    b.addEventListener('abort', abort, { once: true });
    return controller.signal;
  }
}
