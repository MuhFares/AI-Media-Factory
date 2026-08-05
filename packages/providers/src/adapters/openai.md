# OpenAI Adapter — Design Notes

> Design only. No SDK code. Implements [`LlmProvider`](../core/provider.ts), `id: "openai"`.

| Uniform contract | OpenAI mapping |
|---|---|
| `generate` / `stream` | Chat Completions / Responses API (+ SSE streaming) |
| `embed` | Embeddings API |
| `responseFormat: json_schema` | Structured Outputs |
| `tools` | function/tool calling |
| vision content parts | image inputs |
| `Usage` | `usage.prompt_tokens` / `completion_tokens` → cost via catalog |
| errors | 429/5xx → retryable + allowFallback; 401/400 → terminal |

- Key: `OPENAI_API_KEY` (environment). Honors `AbortSignal`.
- Capabilities: text, streaming, json_mode, function_calling, vision, embeddings.
