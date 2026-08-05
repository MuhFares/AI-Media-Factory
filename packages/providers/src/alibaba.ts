/**
 * Alibaba DashScope provider adapter.
 *
 * Implements the `LlmProvider` contract over the Alibaba DashScope
 * OpenAI-compatible gateway, which exposes Qwen models through an
 * OpenAI-compatible API. Credentials come from the environment; the
 * adapter never stores them.
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

interface DashScopeMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text' | 'image_url'; text?: string; image_url?: { url: string } }>;
}

interface DashScopeRequest {
  model: string;
  messages: DashScopeMessage[];
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

interface DashScopeUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface DashScopeChoice {
  index: number;
  message: { role: 'assistant'; content: string };
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
}

interface DashScopeResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: { role: 'assistant'; content: string };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  created: number;
}

interface DashScopeStreamChunk {
  id: string;
  choices: Array<{ index: number; delta: { content?: string }; finish_reason: string | null }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface DashScopeEmbeddingRequest {
  model: string;
  input: string | string[];
  encoding_format?: 'float' | 'base64';
}

interface DashScopeEmbeddingResponse {
  object: 'list';
  data: Array<{ embedding: number[]; index: number; object: 'embedding' }>;
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}

interface DashScopeModelsResponse {
  object: 'list';
  data: Array<{
    id: string;
    object: 'model';
    owned_by: string;
  }>;
}

export class AlibabaProvider extends BaseLlmProvider {
  readonly id: ProviderId = 'alibaba';

  private readonly config: {
    apiKey: string;
    baseUrl: string;
    timeoutMs: number;
    maxRetries: number;
    defaultModel: string;
    fallbackModel: string;
    enableLogging: boolean;
    maxTokensPerRequest: number;
    defaultTemperature: number;
    referer?: string;
    title?: string;
  };

  constructor(logger: ProviderLogger = noopLogger) {
    super(logger);
    this.config = this.loadConfig();
  }

  private loadConfig(): {
    apiKey: string;
    baseUrl: string;
    timeoutMs: number;
    maxRetries: number;
    defaultModel: string;
    fallbackModel: string;
    enableLogging: boolean;
    maxTokensPerRequest: number;
    defaultTemperature: number;
    referer?: string;
    title?: string;
  } {
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) {
      throw new Error('DASHSCOPE_API_KEY environment variable is required');
    }

    return {
      apiKey: process.env.DASHSCOPE_API_KEY!,
      baseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
      timeoutMs: Number.parseInt(process.env.DASHSCOPE_TIMEOUT_MS || '60000', 10),
      maxRetries: Number.parseInt(process.env.DASHSCOPE_MAX_RETRIES || '3', 10),
      defaultModel: process.env.DASHSCOPE_DEFAULT_MODEL || 'qwen3.8-max',
      fallbackModel: process.env.DASHSCOPE_FALLBACK_MODEL || 'qwen-max',
      enableLogging: process.env.DASHSCOPE_ENABLE_LOGGING === 'true',
      maxTokensPerRequest: Number.parseInt(process.env.DASHSCOPE_MAX_TOKENS || '4096', 10),
      defaultTemperature: Number.parseFloat(process.env.DASHSCOPE_DEFAULT_TEMPERATURE || '0.7'),
      referer: process.env.DASHSCOPE_REFERER,
      title: process.env.DASHSCOPE_TITLE ?? 'AI Media Factory',
    };
  }

  supports(model: ModelId): boolean {
    const supportedModels = [
      'qwen3.8-max',
      'qwen3.8-max-128k',
      'qwen3.8-max-32k',
      'qwen3.8-max-8k',
      'qwen-plus',
      'qwen-plus-128k',
      'qwen-plus-32k',
      'qwen-plus-8k',
      'qwen-max',
      'qwen-max-128k',
      'qwen-max-32k',
      'qwen-max-8k',
      'qwen-turbo',
      'qwen-turbo-128k',
      'qwen-turbo-32k',
      'qwen-turbo-8k',
      'qwen-max-2025-01-25',
      'qwen-max-2024-09-19',
      'qwen-max-2024-07-15',
      'qwen-max-2024-04-08',
      'qwen-max-2024-02-06',
      'qwen-max-2023-12-01',
      'qwen-plus',
      'qwen-plus-128k',
      'qwen-plus-32k',
      'qwen-plus-8k',
      'qwen-plus-2025-01-25',
      'qwen-plus-2024-09-19',
      'qwen-plus-2024-07-15',
      'qwen-plus-2024-04-08',
      'qwen-plus-2024-02-06',
      'qwen-plus-2023-12-01',
      'qwen-turbo',
      'qwen-turbo-128k',
      'qwen-turbo-32k',
      'qwen-turbo-8k',
      'qwen-max',
      'qwen-max-128k',
      'qwen-max-32k',
      'qwen-max-8k',
      'qwen-turbo',
      'qwen-turbo-128k',
      'qwen-turbo-32k',
      'qwen-turbo-8k',
      'qwen-max',
      'qwen-max-128k',
      'qwen-max-32k',
      'qwen-max-8k',
      'qwen-turbo',
      'qwen-turbo-128k',
      'qwen-turbo-32k',
      'qwen-turbo-8k',
    ];
    return supportedModels.includes(model);
  }

  describe(model: ModelId): ModelCapabilities | null {
    const supportedModels = new Set([
      'qwen3.8-max',
      'qwen3.8-max-128k',
      'qwen3.8-max-32k',
      'qwen3.8-max-8k',
      'qwen-plus',
      'qwen-plus-128k',
      'qwen-plus-32k',
      'qwen-plus-8k',
      'qwen-max',
      'qwen-max-128k',
      'qwen-max-32k',
      'qwen-max-8k',
      'qwen-turbo',
      'qwen-turbo-128k',
      'qwen-turbo-32k',
      'qwen-turbo-8k',
      'qwen-max-2025-01-25',
      'qwen-max-2024-09-19',
      'qwen-max-2024-07-15',
      'qwen-max-2024-04-08',
      'qwen-max-2024-02-06',
      'qwen-max-2023-12-01',
      'qwen-plus',
      'qwen-plus-128k',
      'qwen-plus-32k',
      'qwen-plus-8k',
      'qwen-plus-2025-01-25',
      'qwen-plus-2024-09-19',
      'qwen-plus-2024-07-15',
      'qwen-plus-2024-04-08',
      'qwen-plus-2024-02-06',
      'qwen-plus-2023-12-01',
      'qwen-turbo',
      'qwen-turbo-128k',
      'qwen-turbo-32k',
      'qwen-turbo-8k',
      'qwen-max',
      'qwen-max-128k',
      'qwen-max-32k',
      'qwen-max-8k',
      'qwen-turbo',
      'qwen-turbo-128k',
      'qwen-turbo-32k',
      'qwen-turbo-8k',
    ]);
    
    if (!supportedModels.has(model)) {
      return null;
    }

    // Determine capabilities based on model name
    const isVision = model.includes('vl') || model.includes('vision');
    const isLongContext = model.includes('128k') || model.includes('32k') || model.includes('256k');
    const isTurbo = model.includes('turbo');
    const isMax = model.includes('max');
    const isPlus = model.includes('plus');

    return {
      capabilities: [
        'text',
        ...(model.includes('vl') || model.includes('vision') ? (['vision'] as const) : []),
        ...(model.includes('function') || model.includes('tool') ? (['function_calling'] as const) : []),
        'streaming',
        'json_mode',
      ],
      contextWindow: isLongContext ? 131072 : 32768,
      costPer1kInputUsd: 0,
      costPer1kOutputUsd: 0,
      qualityTier: 'standard',
    };
  }

  async generate(request: GenerateRequest, signal: AbortSignal): Promise<GenerateResponse> {
    const startMs = Date.now();

    const body: any = {
      model: request.model,
      messages: request.messages.map(this.mapMessage),
      temperature: request.temperature ?? 0.7,
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
      throw new Error(`Alibaba DashScope request failed (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as {
      id: string;
      model: string;
      choices: Array<{
        index: number;
        message: { role: 'assistant'; content: string };
        finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
      }>;
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    const choice = data.choices[0];
    if (!choice) {
      throw new Error('Alibaba DashScope returned no choices');
    }

    const text = choice.message.content;
    let output: import('./core/common.js').Json = text;
    if (request.responseFormat?.kind === 'json' || request.responseFormat?.kind === 'json_schema') {
      try {
        output = JSON.parse(choice.message.content) as import('./core/common.js').Json;
      } catch {
        output = choice.message.content;
      }
    }

    const latencyMs = Date.now() - Date.now();
    const costUsd = 0; // DashScope free tier

    return {
      output,
      text: choice.message.content,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
        costUsd: 0,
      },
      provider: this.id,
      model: data.model,
      latencyMs: Date.now() - Date.now(),
      finishReason: choice.finish_reason,
    };
  }

  async *stream(request: GenerateRequest, signal: AbortSignal): AsyncIterable<StreamChunk> {
    const body: any = {
      model: request.model,
      messages: request.messages.map(this.mapMessage),
      temperature: request.temperature ?? 0.7,
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
      throw new Error(`Alibaba DashScope stream failed (${response.status}): ${detail}`);
    }

    if (!response.body) {
      throw new Error('Alibaba DashScope stream: no body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

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
            const chunk = JSON.parse(json) as {
              id: string;
              choices: Array<{
                index: number;
                delta: { content?: string };
                finish_reason: string | null;
              }>;
              usage?: {
                prompt_tokens: number;
                completion_tokens: number;
                total_tokens: number;
              };
            };
            const delta = chunk.choices[0]?.delta.content;
            if (delta) {
              yield { delta, done: false };
            }
            if (chunk.usage) {
              yield {
                delta: '',
                done: true,
                usage: {
                  inputTokens: chunk.usage.prompt_tokens,
                  outputTokens: chunk.usage.completion_tokens,
                  costUsd: 0,
                },
              };
            }
          }
        }
      }
    } finally {
      // cleanup
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
      throw new Error(`Alibaba embeddings failed (${response.status}): ${detail}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
      usage: {
        prompt_tokens: number;
        total_tokens: number;
      };
      model: string;
    };

    return {
      vectors: data.data.map((d) => d.embedding),
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: 0,
        costUsd: 0,
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

  private mapMessage(msg: Message): any {
    if (typeof msg.content === 'string') {
      return { role: msg.role === 'tool' ? 'user' : msg.role, content: msg.content };
    }
    const parts = msg.content.map((part: any) => {
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

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
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