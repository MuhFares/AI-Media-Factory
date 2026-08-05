# Observability

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `logging.ts` | `ToolLogger`, `InvocationLogEntry`, `ToolError`, `ToolResult`, `ExecutionMetadata`, `SandboxInfo` | #12 |
| `metrics.ts` | `ToolMetrics`, `ToolMetricsSnapshot` | #13 |
| `cost.ts` | `CostTracker`, `CostBreakdown`, `TokenUsage`, `CostEstimator` | #14 |

Logs: structured, correlation-keyed, no secrets. Metrics: latency, success rate, retries, approvals, costs. Costs: per-tool, per-category, per-agent, token tracking.