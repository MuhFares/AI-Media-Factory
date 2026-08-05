# DeepSeek Adapter — Design Notes

> Design only. No SDK code. Implements [`LlmProvider`](../core/provider.ts), `id: "deepseek"`.

| Uniform contract | DeepSeek mapping |
|---|---|
| `generate` / `stream` | OpenAI-compatible chat API (+ streaming) |
| `embed` | not offered → routing sends embeddings elsewhere |
| `responseFormat` | JSON output mode |
| `tools` | function calling |
| vision | not offered → capability omitted; router excludes it for vision requests |
| `Usage` | token counts → cost via catalog (typically low cost — favored by CostAware routing) |
| errors | 429/5xx → retryable + allowFallback; 401/400 → terminal |

- Key: `DEEPSEEK_API_KEY` (environment). Honors `AbortSignal`.
- Capabilities: text, streaming, json_mode, function_calling (no vision, no embeddings).
- Often the cheapest capable option → frequently selected by the CostAware strategy.
