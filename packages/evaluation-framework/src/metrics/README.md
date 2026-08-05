# Metrics

> Contracts only — declarations, no logic.

| File | Defines |
|---|---|
| `metrics.ts` | 50+ standard metric definitions across 7 categories (agent, provider, workflow, prompt, memory, tool, output) |
| `scorecard.ts` | `Scorecard`, `MetricScore`, `CategoryScore`, `GateResult` |

## Metric Categories

| Category | Metrics |
|---|---|
| **Agent** | task_success_rate, avg_latency_ms, autonomy_rate, retry_rate |
| **Provider** | availability, latency_p95, error_rate, cost_per_1k_tokens |
| **Workflow** | success_rate, avg_duration_ms, rework_rate, autonomy_rate |
| **Prompt** | token_efficiency, schema_compliance |
| **Memory** | retrieval_precision, retrieval_recall, conflict_rate |
| **Tool** | success_rate, avg_latency_ms, cost_per_call |
| **Output** | quality_score, schema_compliance, brand_safety |

Each metric has: `id`, `name`, `description`, `unit`, `higherIsBetter`, `normalization`, `category`, `tags`.