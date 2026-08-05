# Finance Agent — Workflow

How the Finance agent executes within the event-driven pipeline. Finance is the controller of the feedback layer: it sits between Analytics and the CEO review, turning measured performance into certified unit economics.

## Position in the pipeline

```
... -> Analytics(AnalyticsReported) -> Finance(FinanceReported)
     -> Orchestrator assembles review package -> CEO Review
```

Finance never sits on the production path (Research -> ... -> Publisher). It runs alongside the feedback layer, and its budget status can throttle production upstream when caps are breached.

## Trigger

- **Event-driven:** the Analytics agent emits `AnalyticsReported` per measured asset.
- **Off-cycle:** a budget breach detected during enforcement can trigger an immediate report and escalation without waiting for the next asset.

## Execution steps

1. Analytics publishes `AnalyticsReported` with metrics and attributed revenue.
2. Finance validates the event against `input.schema.json`.
3. Finance runs the control procedure in [prompts/instructions.md](../prompts/instructions.md): reconcile, cost, apply the Margin gate, enforce budgets, recommend routing.
4. Finance emits exactly one `FinanceReported` (validated against `output.schema.json`) targeted at the CEO.
5. Orchestrator folds `FinanceReported` into the CEO review package alongside the analytics and growth reports.

## Failure handling

- Revenue not reconcilable: Finance reports the cost breakdown, marks the margin verdict `withheld`, and escalates a reconciliation gap; it does not certify uncertain economics.
- Budget breach: Finance sets status `over`, takes the enforcement action (throttle/pause), and escalates the overrun to the CEO.
- Negative unit economics without a mandate: Finance flags `fail` and escalates rather than silently absorbing the loss.
- Retries and dead-lettering are handled by the Orchestrator and event bus, not by Finance.
