# LLM Provider Layer (`@ai-media-factory/providers`)

> Architecture specification for the multi-provider LLM layer of AI Media Factory (AMF). **Contracts and architecture only** — the `src/**/*.ts` files are type/interface declarations with no implementation bodies. This package is the canonical home of everything provider-related; the [runtime](../runtime/README.md) consumes it and never talks to a vendor directly.

## 0. Core principle

**The runtime must never know which LLM it is using.** It calls one method — `generate()` (or `stream()` / `embed()`) — on a unified interface, and this layer decides which vendor and model actually serve the request, transparently handling cost/latency routing, fallback, rate limiting, and health.

```
   Runtime  ──generate(request)──►  PROVIDER LAYER  ──►  (OpenAI | Anthropic | Gemini |
                                          │                OpenRouter | DeepSeek | Mistral | …)
        knows only the unified interface  │
        never a vendor, never a model id  ▼
                              routing · fallback · rate-limit · health · metrics · cost
```

The dependency direction is strict and one-way: **`runtime → providers`**. This package imports nothing from the runtime; it owns its own request/response types so there is no circular dependency and one canonical definition of a provider.

## 1. Supported providers

OpenAI · Anthropic Claude · Google Gemini · OpenRouter · DeepSeek · Mistral · **and any future provider** — added as a new adapter with zero changes to the runtime, the router, or any agent.

---

## 2. The 20 requirements → where each lives

| # | Requirement | Home |
|---|---|---|
| 1 | Unified Interface | `core/provider.ts` (`LlmProvider`) |
| 2 | Provider Registry | `registry/provider-registry.ts` |
| 3 | Model Registry | `registry/model-registry.ts` |
| 4 | Model Capabilities | `core/capabilities.ts` |
| 5 | Automatic Provider Selection | `routing/router.ts` + `routing/selection.ts` |
| 6 | Cost-aware Routing | `routing/selection.ts` (CostAware strategy) |
| 7 | Latency-aware Routing | `routing/selection.ts` (LatencyAware strategy) |
| 8 | Fallback Providers | `routing/fallback.ts` |
| 9 | Retry Logic | `resilience/retry.ts` |
| 10 | Rate Limiting | `resilience/rate-limiter.ts` |
| 11 | Streaming Support | `core/provider.ts` (`stream()`) |
| 12 | Structured JSON Output | `core/request.ts` (`responseFormat`) |
| 13 | Function Calling | `core/request.ts` (`tools`) |
| 14 | Vision Models | `core/request.ts` (multimodal content) + capability flag |
| 15 | Embedding Models | `core/provider.ts` (`embed()`) |
| 16 | Provider Health Monitoring | `observability/health.ts` |
| 17 | Provider Metrics | `observability/metrics.ts` |
| 18 | Cost Tracking | `observability/cost.ts` (`CostMeter`) |
| 19 | Token Tracking | `observability/cost.ts` (`TokenMeter`) |
| 20 | Future extensibility | the adapter + capability model (this whole design) |

---

## 3. Folder structure

```
packages/providers/
├── README.md                     # this document
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                  # barrel (types only)
    ├── core/
    │   ├── README.md
    │   ├── provider.ts           # LlmProvider: generate / stream / embed / health
    │   ├── request.ts            # GenerateRequest/Response, StreamChunk, Embedding*, Message, Tool
    │   ├── capabilities.ts       # Capability, ModelCapabilities
    │   └── errors.ts             # ProviderError taxonomy
    ├── registry/
    │   ├── README.md
    │   ├── provider-registry.ts  # ProviderRegistry
    │   └── model-registry.ts     # ModelRegistry, ModelDescriptor
    ├── routing/
    │   ├── README.md
    │   ├── router.ts             # Router, RoutingRequest, RoutingDecision
    │   ├── selection.ts          # SelectionStrategy, CostAware, LatencyAware, Balanced
    │   └── fallback.ts           # FallbackStrategy, FallbackChain
    ├── resilience/
    │   ├── README.md
    │   ├── retry.ts              # ProviderRetryPolicy
    │   └── rate-limiter.ts       # RateLimiter, TokenBucket
    ├── observability/
    │   ├── README.md
    │   ├── health.ts             # HealthMonitor, HealthState
    │   ├── metrics.ts            # ProviderMetrics
    │   └── cost.ts               # CostMeter, TokenMeter
    ├── adapters/
    │   ├── README.md
    │   ├── openai.md · anthropic.md · gemini.md
    │   ├── openrouter.md · deepseek.md · mistral.md
    └── config/
        └── README.md             # provider/model catalog configuration
```

---

## 4. The unified interface

Every provider adapter implements one interface ([`core/provider.ts`](./src/core/provider.ts)):

```
LlmProvider
  ├─ generate(request)  → GenerateResponse        # single-shot completion
  ├─ stream(request)    → AsyncIterable<Chunk>     # token streaming (req #11)
  ├─ embed(request)     → EmbeddingResponse        # embeddings (req #15)
  ├─ supports(model)    → boolean
  └─ health()           → HealthState              # for monitoring/failover
```

The `GenerateRequest` ([`core/request.ts`](./src/core/request.ts)) carries everything a modern model call needs, vendor-neutral:
- messages (multimodal: text **and** image parts → vision, req #14)
- `responseFormat` (structured JSON output, req #12)
- `tools` (function calling, req #13)
- `stream` flag, temperature, maxTokens
- a **capability requirement** the router uses to pick a model

The runtime maps its own `ExecutionRequest` to a `GenerateRequest`; it never constructs vendor payloads.

---

## 5. Capability matrix (req #4)

Each model declares its capabilities ([`core/capabilities.ts`](./src/core/capabilities.ts)); the router only sends a request to a model that supports every capability the request needs.

| Capability | Meaning |
|---|---|
| `text` | Text generation |
| `streaming` | Token streaming |
| `json_mode` | Structured JSON / schema-constrained output |
| `function_calling` | Tool/function calling |
| `vision` | Image input |
| `embeddings` | Vector embeddings |
| `long_context` | Extended context window |

Illustrative matrix (concrete values live in [`configs/models`](../../configs/models/README.md), not hardcoded here):

| Provider (example model) | text | streaming | json | functions | vision | embeddings |
|---|---|---|---|---|---|---|
| OpenAI | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Anthropic | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Gemini | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| OpenRouter | ✓ | ✓ | ~ | ~ | ~ | ~ |
| DeepSeek | ✓ | ✓ | ✓ | ✓ | — | — |
| Mistral | ✓ | ✓ | ✓ | ✓ | ~ | ✓ |

(✓ supported · ~ model-dependent · — not offered. Source of truth is the Model Registry, populated from `configs/models`.)

---

## 6. Routing flow (reqs #5–#8)

```
 generate(request)
     │
     ▼
 (1) CAPABILITY FILTER   Model Registry → models that support every required capability
     │                    (e.g. needs vision + json → drop models lacking either)
     ▼
 (2) HEALTH FILTER       HealthMonitor → drop unhealthy/circuit-open providers
     │
     ▼
 (3) RATE-LIMIT FILTER   RateLimiter → drop providers with no budget right now
     │
     ▼
 (4) SELECTION STRATEGY  rank survivors:
     │                     • CostAware   → cheapest that meets the quality tier
     │                     • LatencyAware → fastest observed p50/p95
     │                     • Balanced    → weighted cost × latency × reliability
     ▼
 (5) PRIMARY PICK        top-ranked (provider, model)
     │
     ▼ invoke  ──success──► response (+ metrics, cost, tokens recorded)
     │
     └─ failure (retryable) ─► RETRY (same model) ─► exhausted ─► FALLBACK CHAIN
                                                                    │
                                                                    ▼
                                                      next-best candidate → invoke → …
                                                      (until success or chain exhausted → ProviderError)
```

The runtime is unaware of all of this. It called `generate()` once.

### 6.1 Selection algorithm (req #5–#7)

```
candidates = ModelRegistry.filter(required_capabilities)
candidates = candidates.filter(HealthMonitor.isHealthy)
candidates = candidates.filter(RateLimiter.hasBudget)

score(model) depends on strategy:
   CostAware:    minimize  cost_per_1k_tokens        (subject to meeting quality tier)
   LatencyAware: minimize  observed_latency_p95
   Balanced:     minimize  w_c·norm(cost) + w_l·norm(latency) − w_r·reliability

pick = argmin/argmax score(candidates)
fallbackChain = remaining candidates in score order
```

Strategy is configurable per agent/task via [`configs/models`](../../configs/models/README.md) — a cost-sensitive agent uses CostAware; a latency-sensitive one uses LatencyAware. The default is Balanced.

### 6.2 Fallback strategy (req #8)

```
FallbackChain = [primary, 2nd-best, 3rd-best, …]  (from the ranked candidates)

on ProviderError(retryable) after retries exhausted on model N:
    advance to model N+1 in the chain (may be a different vendor)
on ProviderError(terminal, e.g. auth/bad-request):
    do not fall back for that cause; surface the error
chain exhausted:
    raise aggregated ProviderError with per-attempt detail
```

Fallback crosses vendors: an OpenAI outage can fail over to Anthropic or OpenRouter automatically, because selection ranks across all healthy providers that meet the capabilities.

---

## 7. Class responsibilities

| Collaborator | Single responsibility |
|---|---|
| `LlmProvider` | The unified vendor contract (generate/stream/embed/health/supports) |
| `ProviderRegistry` | Register and look up provider adapters by id/model |
| `ModelRegistry` | Catalog of models + their capabilities, cost, and latency profile |
| `Router` | Turn a request into a chosen `(provider, model)` + fallback chain |
| `SelectionStrategy` | Rank candidate models (CostAware / LatencyAware / Balanced) |
| `FallbackStrategy` | Advance through the ranked chain on failure |
| `ProviderRetryPolicy` | Bounded, backed-off retries within one provider |
| `RateLimiter` | Enforce per-provider request/token budgets (token bucket) |
| `HealthMonitor` | Track provider health; open/close a circuit breaker |
| `ProviderMetrics` | Record calls, latencies, errors, throughput per provider/model |
| `CostMeter` | Convert token usage to `cost_usd` per call |
| `TokenMeter` | Track input/output token counts |

All are interfaces; the router depends on abstractions, so providers and strategies are swappable.

---

## 8. Monitoring, metrics, logging, cost

- **Health (req #16):** `HealthMonitor` probes and passively observes each provider; a provider that errors past a threshold has its **circuit opened** and is skipped by routing until it recovers. See [`observability/health.ts`](./src/observability/health.ts).
- **Metrics (req #17):** `ProviderMetrics` records per-provider/model call counts, latency p50/p95, error rates, and throughput — fed to [infra/monitoring](../../infra/monitoring/README.md) and the [Analytics Brain](../../memory/company/analytics-brain.md).
- **Cost + tokens (reqs #18–#19):** `CostMeter`/`TokenMeter` attach `cost_usd` and token counts to every response; these flow into the event `metadata` the [Finance Brain](../../memory/company/finance-brain.md) consumes and enforce the Margin gate.
- **Logging:** structured, correlation-keyed, secret-free (credentials from the environment only). Routing decisions are logged (which model chosen and why) for auditability.

## 9. Configuration

Providers and models are **data-driven**, not hardcoded:
- **Credentials** from the environment ([`configs/environments`](../../configs/environments/README.md)): `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY`.
- **Model catalog** (ids, capabilities, cost/latency tiers, which vendor) from [`configs/models`](../../configs/models/README.md), loaded into the `ModelRegistry`.
- **Routing strategy** per agent/task from the same config. Agents reference **logical tiers** (e.g. `language-tier-large`), never vendor model names — this layer resolves the tier.

See [`src/config/README.md`](./src/config/README.md).

## 10. Future extensibility (req #20)

Adding a provider (e.g. a 7th vendor) is exactly three steps, none touching the runtime or agents:
1. Write an adapter implementing `LlmProvider`.
2. Register it in the `ProviderRegistry`.
3. Add its models + capabilities + cost to the Model Registry (via `configs/models`).

The capability model means new modalities (audio, video-gen) extend the `Capability` set without breaking existing routing.

## 11. Relationship to the runtime

`packages/providers` is the **canonical** provider layer. The earlier `packages/runtime/src/providers/` (from the runtime task) now re-exports from here so there is a single source of truth (no duplicate `LlmProvider` definitions). The runtime's `LlmExecutor` maps its `ExecutionRequest` → this layer's `GenerateRequest`, calls `generate()`, and maps the response back — knowing nothing about the vendor.

## 12. Boundaries — what this layer never does

- **Never leaks a vendor to the caller.** The runtime sees only the unified interface.
- **Never makes business decisions.** It picks a *model*, not a strategy; agents/CEO decide content and direction.
- **Never hardcodes models or keys.** Catalog from `configs/models`, keys from the environment.
- **Never logs secrets or raw prompts verbatim.**
- **Never guarantees vendor schema conformance blindly.** Structured output is still validated upstream by the runtime's `SchemaValidator`.

## Status

Contracts and architecture only. No implementation. This is the specification a provider implementation will satisfy.

## Related documents

- [Runtime](../runtime/README.md) — the sole consumer of this layer
- [configs/models](../../configs/models/README.md) — the model catalog + routing config
- [Finance Brain](../../memory/company/finance-brain.md) — consumes cost/token metrics; owns the Margin gate
- [Analytics Brain](../../memory/company/analytics-brain.md) — consumes provider metrics
- [Event Bus](../../docs/architecture/event-bus.md) — carries the cost/model metadata this layer produces
