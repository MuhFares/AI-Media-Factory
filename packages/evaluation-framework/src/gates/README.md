# Gates

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `gates.ts` | `QualityGate`, `GateThresholds`, `GateEvaluationResult`, `STANDARD_QUALITY_GATES` | #3 |

20+ standard quality gates covering agents, providers, workflows, prompts, memory, tools, and outputs. Each gate has pass/warn/fail/block thresholds and an `onFail` action (warn/fail/block). Gates are evaluated as part of the evaluation pipeline.