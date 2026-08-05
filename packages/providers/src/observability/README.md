# Observability

> Contracts only — declarations, no logic.

| File | Defines | Requirement |
|---|---|---|
| `health.ts` | `HealthMonitor`, `HealthState` — health + circuit breaker | #16 |
| `metrics.ts` | `ProviderMetrics`, `CallOutcome` — calls, latency p50/p95, error rate, throughput | #17 |
| `cost.ts` | `CostMeter`, `TokenMeter` — USD cost + token counts | #18, #19 |

- **Health** filters unhealthy providers out of routing (circuit breaker); recovers automatically.
- **Metrics** ship to [infra/monitoring](../../../../infra/monitoring/README.md) and the [Analytics Brain](../../../../memory/company/analytics-brain.md).
- **Cost/tokens** attach to every response and flow into event `metadata` for the [Finance Brain](../../../../memory/company/finance-brain.md) and the Margin gate.
