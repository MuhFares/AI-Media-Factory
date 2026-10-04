/**
 * OpenRouter provider adapter — hardened for Nemotron Super streaming.
 *
 * Implements the `LlmProvider` contract over the OpenRouter unified gateway.
 * Credentials come from the environment; the adapter never stores them and
 * never logs them. Streaming correctly isolates visible business output from
 * hidden reasoning (reasoning_details/reasoning_content) and parses usage
 * safely including reasoning_tokens and cost.
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
import {
  summarizeChatCompletionResponse,
  parseChatCompletionResponse,
  ChatCompletionContentError,
  type RawResponseMeta,
} from './structured-output.js';

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
  response_format?: { type: 'json_object' } | { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: unknown } };
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>;
  // reasoning parameter intentionally OMITTED for baseline Nemotron canary (see task §7)
}

interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost?: number;
  is_byok?: boolean;
  prompt_tokens_details?: Record<string, unknown>;
  completion_tokens_details?: { reasoning_tokens?: number; image_tokens?: number; audio_tokens?: number };
  cost_details?: { upstream_inference_cost?: number; upstream_inference_prompt_cost?: number; upstream_inference_completions_cost?: number };
}

interface OpenRouterChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string | Array<{ type?: string; kind?: string; text?: string; image_url?: { url: string } }>;
    refusal?: string | null;
    reasoning?: string;
    reasoning_content?: string;
    reasoning_details?: unknown[];
  };
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

interface OpenRouterResponse {
  id: string;
  model: string;
  provider?: string;
  choices: OpenRouterChoice[];
  usage: OpenRouterUsage;
  created: number;
}

interface OpenRouterStreamChunk {
  id?: string;
  model?: string;
  provider?: string;
  choices: Array<{ index: number; delta: { content?: string; reasoning?: string; reasoning_content?: string; reasoning_details?: unknown[] }; finish_reason?: string | null }>;
  usage?: OpenRouterUsage;
}

/** Exported for focused URL-construction tests. */
export function buildOpenRouterUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
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

    if (request.responseFormat?.kind === 'json_schema') {
      if (request.responseFormat.schema === undefined) throw new Error('OpenRouter json_schema request requires schema');
      body.response_format = { type: 'json_schema', json_schema: { name: 'amf_structured_output', strict: true, schema: request.responseFormat.schema } };
    } else if (request.responseFormat?.kind === 'json') {
      body.response_format = { type: 'json_object' };
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const response = await this.fetch(buildOpenRouterUrl(this.config.baseUrl, '/chat/completions'), {
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
    const rawMeta: RawResponseMeta = summarizeChatCompletionResponse(data, response.status);
    // Canonical failure diagnostics: attached to EVERY thrown error below so
    // future operator paths persist evidence automatically instead of relying
    // on each script remembering. Sanitized by construction (presence
    // booleans only — never reasoning text, never secrets).
    const failureDiagnostics = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
      requestedModel: request.model,
      maxTokens: request.maxOutputTokens ?? null,
      responseFormat: request.responseFormat?.kind ?? null,
      stream: request.stream ?? false,
      rawMeta: { ...rawMeta },
      ...extra,
    });
    const failWith = (message: string, extra: Record<string, unknown> = {}): never => {
      const error = new Error(message) as Error & { diagnostics?: Record<string, unknown> };
      error.diagnostics = failureDiagnostics(extra);
      throw error;
    };
    const choice = data.choices[0];
    if (!choice) {
      failWith('OpenRouter returned no choices');
    }

    // Visible output only — never reasoning, tool calls, or refusal text.
    // Content-part arrays assemble text parts; refusal fails distinctly.
    let text: string;
    try {
      text = parseChatCompletionResponse(data).text;
    } catch (error) {
      if (error instanceof ChatCompletionContentError && error.code === 'REFUSAL_PRESENT') {
        failWith('OpenRouter refused the request');
      }
      if (error instanceof ChatCompletionContentError) {
        failWith(`OpenRouter returned empty visible content (finish_reason=${String(choice.finish_reason)})`);
      }
      throw error;
    }

    // Guard incomplete truncation.
    if (choice.finish_reason === 'length') {
      failWith(`OpenRouter returned incomplete response (length)`);
    }

    let output: import('./core/common.js').Json = text;
    if (request.responseFormat?.kind === 'json' || request.responseFormat?.kind === 'json_schema') {
      try {
        output = JSON.parse(text) as import('./core/common.js').Json;
      } catch {
        output = text;
      }
    }

    const latencyMs = Date.now() - startMs;
    // Usage is provider-reported; absent usage zero-fills the accounting
    // fields while rawMeta preserves UNKNOWN (never fabricate authoritative
    // numbers). Prefer provider-reported cost when present, else estimate.
    const usageRecord = (data.usage ?? {}) as Partial<OpenRouterUsage>;
    const promptTokens = typeof usageRecord.prompt_tokens === 'number' ? usageRecord.prompt_tokens : 0;
    const completionTokens = typeof usageRecord.completion_tokens === 'number' ? usageRecord.completion_tokens : 0;
    const costUsd = typeof usageRecord.cost === 'number' ? usageRecord.cost : modelRegistry.estimateCost(request.model, promptTokens, completionTokens);

    return {
      output,
      text,
      usage: {
        inputTokens: promptTokens,
        outputTokens: completionTokens,
        costUsd,
      },
      provider: this.id,
      model: data.model,
      latencyMs,
      finishReason: (choice.finish_reason as GenerateResponse['finishReason']) ?? 'stop',
      rawMeta,
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

    if (request.responseFormat?.kind === 'json_schema') {
      if (request.responseFormat.schema === undefined) throw new Error('OpenRouter json_schema request requires schema');
      body.response_format = { type: 'json_schema', json_schema: { name: 'amf_structured_output', strict: true, schema: request.responseFormat.schema } };
    } else if (request.responseFormat?.kind === 'json') {
      body.response_format = { type: 'json_object' };
    }

    // reasoning parameter intentionally omitted (§7)

    const response = await this.fetch(buildOpenRouterUrl(this.config.baseUrl, '/chat/completions'), {
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
    let seenDone = false;
    let finishReason: string | null = null;
    let seenContent = false;
    let generationId: string | null = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed.startsWith(":")) continue;
          if (trimmed === 'data: [DONE]') {
            seenDone = true;
            continue;
          }
          if (!trimmed.startsWith('data: ')) continue;
          const json = trimmed.slice(6);
          let chunk: OpenRouterStreamChunk;
          try {
            chunk = JSON.parse(json) as OpenRouterStreamChunk;
          } catch {
            throw new Error(`OpenRouter stream malformed event: ${json.slice(0,120)}`);
          }
          if (typeof (chunk as unknown as Record<string, unknown>).id === 'string' && !generationId && String((chunk as unknown as Record<string, unknown>).id).startsWith('gen-')) generationId = String((chunk as unknown as Record<string, unknown>).id);
          // Capture finish_reason when present (may be in any chunk).
          const fr = chunk.choices?.[0]?.finish_reason;
          if (typeof fr === 'string' && fr.length > 0) finishReason = fr;

          // Usage may arrive in final chunk (or separate chunk).
          if (chunk.usage) {
            const costUsd = typeof chunk.usage.cost === 'number' ? chunk.usage.cost : modelRegistry.estimateCost(request.model, chunk.usage.prompt_tokens, chunk.usage.completion_tokens);
            yield {
              delta: '',
              done: true,
              usage: {
                inputTokens: chunk.usage.prompt_tokens,
                outputTokens: chunk.usage.completion_tokens,
                costUsd,
              },
            };
            continue;
          }

          const delta = chunk.choices?.[0]?.delta;
          if (!delta) continue;

          // Reasoning isolation: observe presence but never yield reasoning.
          // We intentionally ignore delta.reasoning / delta.reasoning_content / delta.reasoning_details.
          const visible = typeof delta.content === 'string' ? delta.content : '';
          if (visible.length > 0) {
            seenContent = true;
            yield { delta: visible, done: false };
          }
        }
      }

      // Validate stream termination.
      if (!seenDone) {
        throw new Error('OpenRouter stream missing [DONE]');
      }
      if (finishReason === 'length') {
        throw new Error('OpenRouter stream incomplete response (length)');
      }
      if (!seenContent) {
        throw new Error('OpenRouter stream returned no visible content');
      }
    } finally {
      reader.releaseLock();
    }
  }

  /** Synthetic streaming helper for focused local tests — no network. */
  static parseSseForTests(events: string[]): { visibleText: string; finishReason: string | null; hadDone: boolean; reasoningPresent: boolean; reasoningDetailsPresent: boolean; reasoningDetailCount: number; generationId: string | null } {
    let visibleText = '';
    let finishReason: string | null = null;
    let hadDone = false;
    let reasoningPresent = false;
    let reasoningDetailsPresent = false;
    let reasoningDetailCount = 0;
    let generationId: string | null = null;
    for (const line of events) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue;
      if (trimmed === 'data: [DONE]') { hadDone = true; continue; }
      if (!trimmed.startsWith('data: ')) continue;
      const chunk = JSON.parse(trimmed.slice(6)) as OpenRouterStreamChunk & { id?: string };
      const fr = chunk.choices?.[0]?.finish_reason;
      if (typeof fr === 'string') finishReason = fr;
      const d = chunk.choices?.[0]?.delta as Record<string, unknown> | undefined;
      if (d && (d.reasoning !== undefined || d.reasoning_content !== undefined)) reasoningPresent = true;
      if (d && d.reasoning_details !== undefined) {
        reasoningDetailsPresent = true;
        if (Array.isArray(d.reasoning_details)) reasoningDetailCount = Math.max(reasoningDetailCount, (d.reasoning_details as unknown[]).length);
      }
      if (typeof chunk.id === 'string' && !generationId && chunk.id.startsWith('gen-')) generationId = chunk.id;
      const c = chunk.choices?.[0]?.delta.content;
      if (typeof c === 'string') visibleText += c;
    }
    return { visibleText, finishReason, hadDone, reasoningPresent, reasoningDetailsPresent, reasoningDetailCount, generationId };
  }

  async embed(request: EmbeddingRequest, signal: AbortSignal): Promise<EmbeddingResponse> {
    const response = await this.fetch(buildOpenRouterUrl(this.config.baseUrl, '/embeddings'), {
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

    const costUsd = typeof data.usage.cost === 'number' ? data.usage.cost : modelRegistry.estimateCost(request.model, data.usage.prompt_tokens, 0);

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

      const response = await this.fetch(buildOpenRouterUrl(this.config.baseUrl, '/models'), {
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
