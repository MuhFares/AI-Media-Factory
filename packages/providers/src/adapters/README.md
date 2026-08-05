# Provider Adapters

> Design notes only. No vendor SDK code. Each adapter implements the unified [`LlmProvider`](../core/provider.ts) contract and maps it to/from a specific vendor API.

Adding a provider is a new adapter here + a Model Registry entry ([`configs/models`](../../../configs/models/README.md)) — no change to the runtime, router, or agents (req #20).

## Every adapter must

| Concern | Requirement |
|---|---|
| `generate` / `stream` / `embed` | Map the uniform request to the vendor API and normalize the response |
| Usage → cost | Emit `Usage` with input/output tokens and `costUsd` (via `CostMeter`) |
| Capabilities | Report accurate `ModelCapabilities` so routing never sends an unsupported request |
| Errors | Map vendor errors to `ProviderError` with correct `retryable`/`allowFallback` flags |
| Cancellation | Honor the `AbortSignal` |
| Credentials | Read the vendor key from the environment only; never log it |
| Structured output | Best-effort vendor JSON mode; final validation remains upstream in the runtime |

## Adapters

- [OpenAI](./openai.md)
- [Anthropic](./anthropic.md)
- [Gemini](./gemini.md)
- [OpenRouter](./openrouter.md)
- [DeepSeek](./deepseek.md)
- [Mistral](./mistral.md)
