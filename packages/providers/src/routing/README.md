# Routing

> Contracts only — declarations, no logic. Automatic, capability-aware, cost/latency-aware model selection with cross-vendor fallback.

| File | Defines | Requirement |
|---|---|---|
| `router.ts` | `Router`, `RoutingRequest`, `RoutingDecision` | #5 |
| `selection.ts` | `SelectionStrategy` + `cost_aware` / `latency_aware` / `balanced` | #5, #6, #7 |
| `fallback.ts` | `FallbackStrategy`, `FallbackCandidate` | #8 |

## Flow

```
route(request):
  candidates = ModelRegistry.filterByCapabilities(request.requires)   # capability filter
  candidates = candidates where HealthMonitor.isHealthy(provider)     # health filter
  candidates = candidates where RateLimiter.hasBudget(provider)       # rate-limit filter
  ranked     = SelectionStrategy.rank(candidates, context)            # cost/latency/balanced
  return { primary: ranked[0], fallbackChain: ranked[1..] }
```

On a retryable/`unavailable` `ProviderError` after per-provider retries are exhausted, the caller advances the `fallbackChain` via `FallbackStrategy.next()` — which may cross vendors. Terminal errors (`auth`/`bad_request`) do not fall back. See the parent [README](../../README.md) §6.
