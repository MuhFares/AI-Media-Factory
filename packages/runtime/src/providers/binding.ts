import type { ExecutionRequest, ExecutionResponse, Usage } from "../interfaces/execution.js";
import type { CancellationToken } from "../interfaces/resilience.js";
import type { GenerateRequest, GenerateResponse, Usage as ProviderUsage } from "@ai-media-factory/providers";
import type { RuntimeProviderBinding } from "./provider.js";
import { Router } from "@ai-media-factory/providers";

export class DefaultRuntimeProviderBinding implements RuntimeProviderBinding {
  private readonly router: Router;

  constructor(router: Router) {
    this.router = router;
  }

  toGenerateRequest(request: ExecutionRequest): GenerateRequest {
    const messages: GenerateRequest["messages"] = request.messages.map((msg) => ({
      role: msg.role,
      content: [{ kind: "text", text: msg.content }],
    }));

    const responseFormat: GenerateRequest["responseFormat"] = request.responseSchema
      ? { kind: "json_schema", schema: request.responseSchema }
      : undefined;

    return {
      model: request.model,
      messages,
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      responseFormat,
    };
  }

  fromGenerateResponse(response: GenerateResponse): ExecutionResponse {
    const usage: Usage = {
      inputTokens: response.usage.inputTokens,
      outputTokens: response.usage.outputTokens,
      costUsd: response.usage.costUsd,
    };

    return {
      output: response.output,
      raw: response.text,
      usage,
      model: response.model,
      provider: response.provider,
      latencyMs: response.latencyMs,
    };
  }

  async run(request: ExecutionRequest, signal: CancellationToken): Promise<ExecutionResponse> {
    const generateRequest = this.toGenerateRequest(request);
    const abortSignal = signal as unknown as AbortSignal;

    const routingDecision = await this.router.route({
      request: generateRequest,
      strategy: "balanced",
    });

    let lastError: Error | null = null;

    const candidates = [routingDecision.primary, ...routingDecision.fallbackChain];

    for (const candidate of candidates) {
      try {
        const response = await candidate.provider.generate(generateRequest, abortSignal);
        return this.fromGenerateResponse(response);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }
    }

    throw lastError ?? new Error("All provider candidates failed");
  }
}