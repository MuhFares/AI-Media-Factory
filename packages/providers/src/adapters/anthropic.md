# Anthropic Adapter — Design Notes

> Design only. No SDK code. Implements [`LlmProvider`](../core/provider.ts), `id: "anthropic"`.

| Uniform contract | Anthropic mapping |
|---|---|
| system prompt | top-level `system` parameter (not a message) |
| `generate` / `stream` | Messages API (+ streaming) |
| `embed` | not offered → `describe()` omits `embeddings`; router routes embeddings elsewhere |
| `responseFormat` | tool-use convention to elicit schema-conformant JSON |
| `tools` | tool use |
| vision content parts | image blocks |
| `Usage` | `usage.input_tokens` / `output_tokens` → cost via catalog |
| errors | 429/529/5xx → retryable + allowFallback; 401/400 → terminal |

- Key: `ANTHROPIC_API_KEY` (environment). Honors `AbortSignal`.
- Capabilities: text, streaming, json_mode, function_calling, vision (no embeddings).
