# Policies

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `policies.ts` | `ToolPolicy`, `PolicyEngine`, `PolicyDecision`, `TimeWindow` | #5 |

Policies control concurrency, rate limits, approval requirements, cost ceilings, and time windows. The `PolicyEngine` evaluates all policies before tool execution.