# Resilience

> Contracts only — declarations, no logic.

| File | Defines | Requirement |
|---|---|---|
| `retry.ts` | `ProviderRetryPolicy` — bounded, backed-off retries within one provider | #9 |
| `rate-limiter.ts` | `RateLimiter`, `RateLimitState` — per-provider request/token budgets | #10 |

Retry happens **inside** a single provider first (transient 429/5xx/timeout). Only when retries are exhausted does the [router](../routing/README.md) advance the cross-vendor fallback chain. The `RateLimiter` is also a routing filter: a provider with no budget right now is skipped during selection, not just throttled at call time. Aligned with the [Event Bus retry strategy](../../../../docs/architecture/event-bus.md).
