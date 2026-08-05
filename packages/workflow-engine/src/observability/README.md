# Observability

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `metrics.ts` | `WorkflowMetrics` — cycle time, step latencies, retries, rework, autonomy, cost | #18 |
| `logging.ts` | `WorkflowLogger` — structured, correlation-keyed, no secrets | #19 |
| `audit.ts` | `AuditTrail` — append-only decision log for governance | #20 |

Metrics ship to [infra/monitoring](../../../../infra/monitoring/README.md) and the [Analytics Brain](../../../../memory/company/analytics-brain.md). Logs are structured, correlation-keyed (`workflow_id`, `correlation_id`, `step_id`). The audit trail is append-only: every decision (step, branch, approval, compensation, outcome) is recorded for governance.