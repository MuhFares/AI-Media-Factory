# Mistral Adapter — Design Notes

> Design only. No SDK code. Implements [`LlmProvider`](../core/provider.ts), `id: "mistral"`.

| Uniform contract | Mistral mapping |
|---|---|
| `generate` / `stream` | Chat Completions API (+ streaming) |
| `embed` | Embeddings API |
| `responseFormat` | JSON mode |
| `tools` | function calling |
| vision | model-dependent (multimodal models only) |
| `Usage` | token counts → cost via catalog |
| errors | 429/5xx → retryable + allowFallback; 401/400 → terminal |

- Key: `MISTRAL_API_KEY` (environment). Honors `AbortSignal`.
- Capabilities: text, streaming, json_mode, function_calling, embeddings; vision on multimodal models only.
