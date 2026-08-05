# Provider Abstraction — moved

> This layer has been **canonicalized** into its own package: [`@ai-media-factory/providers`](../../../providers/README.md).

Earlier, a minimal provider abstraction lived here (supporting 4 vendors). It has been superseded by the dedicated **LLM Provider Layer** package, which is broader and the single source of truth:

- Unified `LlmProvider` interface (`generate` / `stream` / `embed`)
- Provider Registry + Model Registry + capability matrix
- Automatic, cost-aware and latency-aware routing with cross-vendor fallback
- Rate limiting, retry, health monitoring, metrics, cost/token tracking
- Six adapters: OpenAI, Anthropic, Gemini, OpenRouter, DeepSeek, Mistral (+ future)

## How the runtime uses it

The runtime depends on `@ai-media-factory/providers` and binds to it through [`provider.ts`](./provider.ts) (`RuntimeProviderBinding`) and [`registry.ts`](./registry.ts). The runtime's `LlmExecutor` maps its `ExecutionRequest` → the provider layer's `GenerateRequest`, calls `generate()`, and maps the response back — knowing nothing about which vendor answers.

The old single-type `LlmProvider`/`ProviderSelector` definitions and the per-vendor design notes that used to live here have moved to [`packages/providers/`](../../../providers/README.md) to avoid a duplicate, competing definition (one source of truth).

See:
- [Provider layer README](../../../providers/README.md)
- [Adapters](../../../providers/src/adapters/README.md)
- [Routing](../../../providers/src/routing/README.md)
