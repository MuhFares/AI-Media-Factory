# Gemini Adapter — Design Notes

> Design only. No SDK code. Implements [`LlmProvider`](../core/provider.ts), `id: "gemini"`.

| Uniform contract | Gemini mapping |
|---|---|
| system prompt | `systemInstruction` |
| `generate` / `stream` | generateContent / streamGenerateContent |
| `embed` | embedContent |
| `responseFormat` | `responseMimeType: application/json` + `responseSchema` |
| `tools` | function declarations |
| vision content parts | inline image parts |
| `Usage` | `usageMetadata` token counts → cost via catalog |
| errors | 429/5xx → retryable + allowFallback; 400/401/403 → terminal |

- Key: `GEMINI_API_KEY` (environment). Honors `AbortSignal`.
- Role normalization: `model` ↔ uniform `assistant`.
- Capabilities: text, streaming, json_mode, function_calling, vision, embeddings.
