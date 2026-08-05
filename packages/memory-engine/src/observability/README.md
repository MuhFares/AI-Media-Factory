# Observability

> Contracts only — declarations, no logic.

`metrics.ts` defines `MemoryMetrics` (req #25): retrieval latency (p50/p95), hit/miss and cache-hit rates, records-per-query, confidence distribution, conflict rate, compression ratio, expiration/archival volumes, and the **learning-loop signal** (memories reinforced / lessons advanced per workflow).

Shipped to [infra/monitoring](../../../infra/monitoring/README.md) and consumed by the [Analytics Brain](../../../memory/company/analytics-brain.md). The learning-loop signal is how the company verifies the Memory Intelligence guarantee — that every workflow leaves it measurably smarter.
