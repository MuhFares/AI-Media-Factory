# Core

> Contracts only — declarations, no logic.

| File | Defines |
|---|---|
| `common.ts` | `EvaluationId`, `AgentId`, `ProviderId`, `WorkflowId`, `EvaluationTargetType`, `EvaluationTrigger`, `EvaluationStatus`, `GateDecision`, `Timestamp`, `Json` |
| `engine.ts` | `EvaluationEngine` — main entry point: `evaluate(request) → EvaluationResult` |
| `request.ts` | `EvaluationRequest`, `EvaluationCriteria`, `MetricThreshold`, `EvaluationConfig`, `EvaluationResult`, `CriteriaScore`, `EvaluationError` |

The `EvaluationEngine` is the single entry point. It takes an `EvaluationRequest` (what to evaluate, criteria, config) and returns an `EvaluationResult` with scores, gate decisions, and errors.