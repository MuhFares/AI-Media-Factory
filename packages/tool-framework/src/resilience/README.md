# Resilience

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `retry.ts` | `RetryPolicy`, `ToolRetryPolicy`, `ToolError` | #8 |
| `timeout.ts` | `TimeoutController`, `TimeoutConfig`, `TimeoutState` | #9 |

Default retry: 3 attempts, exponential backoff (1s, 2s, 4s, max 30s) with jitter. Retryable: timeout, rate limit, server error. Non-retryable: validation, permission, approval, auth errors.