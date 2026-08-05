# Core Contracts

> Contracts only — type/interface declarations, no logic.

The heart of the provider layer. Everything else (registry, routing, resilience, observability, adapters) depends on these.

| File | Defines |
|---|---|
| `common.ts` | `ProviderId` (open-ended for future vendors), `ModelId`, `Json` |
| `provider.ts` | `LlmProvider` — the unified interface: `generate` / `stream` / `embed` / `describe` / `supports` / `health` |
| `request.ts` | `GenerateRequest` / `GenerateResponse`, `StreamChunk`, `EmbeddingRequest` / `EmbeddingResponse`, `Message`, `ContentPart` (vision), `ToolDef` (function calling), `ResponseFormat` (JSON), `Usage` |
| `capabilities.ts` | `Capability`, `ModelCapabilities` |
| `errors.ts` | `ProviderError` taxonomy |

These types are **owned here**, not imported from the runtime — the dependency runs `runtime → providers` only, so there is no cycle and one canonical definition.
