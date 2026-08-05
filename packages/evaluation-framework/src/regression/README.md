# Regression Tests

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `regression.ts` | `RegressionTest`, `RegressionTestConfig`, `RegressionBaseline`, `RegressionAlert`, `RegressionTestResult`, `ScheduledRegressionRun`, schedules | #5 |

Automated regression detection with statistical significance testing (p-value, effect size). Schedules: daily full regression (2 AM), on-deployment, weekly comprehensive (Sunday 3 AM).