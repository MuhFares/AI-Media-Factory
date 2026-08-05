# OpenRouter Adapter — Design Notes

> Design only. No SDK code. Implements [`LlmProvider`](../core/provider.ts), `id: "openrouter"`.

A gateway fronting many vendors behind an OpenAI-compatible API. Acts as breadth + a cross-vendor fallback safety net.

| Uniform contract | OpenRouter mapping |
|---|---|
| `generate` / `stream` | OpenAI-compatible chat schema (+ streaming) |
| `model` | fully-qualified `vendor/model` routed by the gateway |
| `responseFormat` | JSON response-format where the underlying model supports it |
| `tools` | where the underlying model supports it |
| `Usage` | gateway-normalized usage → cost reconciled with catalog |
| errors | gateway 429/5xx → retryable + allowFallback; 401/400 → terminal |

- Key: `OPENROUTER_API_KEY` (environment). Honors `AbortSignal`.
- Capabilities are **model-dependent** — `describe()` reports per underlying model; routing must not assume uniform json/vision/tools support.
- Strong default candidate for the fallback chain.
