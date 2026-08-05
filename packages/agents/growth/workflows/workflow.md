# Growth Agent — Workflow

How the Growth agent executes within the event-driven pipeline. Growth sits on the feedback layer, running alongside Finance to turn measured performance into reversible experiments.

## Position in the pipeline

```
... -> Analytics(AnalyticsReported) -> Growth(GrowthProposed)
     -> Orchestrator assembles review package -> CEO Review
```

Growth never sits on the production path (Research -> ... -> Publisher). It runs alongside the feedback layer, reads the experiments/ab-tests registry, and feeds its proposals into the CEO review.

## Trigger

- **Event-driven:** the Analytics agent emits `AnalyticsReported`, seeding new hypotheses.
- **Test lifecycle:** a running A/B test reaching its sample or window can trigger an evaluation-and-propose cycle out of band.

## Execution steps

1. Analytics publishes `AnalyticsReported` with metrics and insights.
2. Growth validates the event against `input.schema.json` and reads the experiments/ab-tests registry.
3. Growth runs the experiment procedure in [prompts/instructions.md](../prompts/instructions.md): find opportunity, form hypotheses, classify doors, run reversible tests, evaluate wins.
4. Growth promotes proven tactics to playbooks/ and records their effect size.
5. Growth emits exactly one `GrowthProposed` (validated against `output.schema.json`) targeted at the CEO.

## Failure handling

- Underpowered or noisy test: Growth marks the experiment `inconclusive` and does not promote it; no win is claimed on weak evidence.
- Guardrail breach: Growth pauses the test at the guardrail, reports partial results, and requests a revised bound rather than overspending.
- One-way-door opportunity: Growth emits a `channel_expansion_proposal` and stops; it never launches an expansion itself.
- Retries and dead-lettering are handled by the Orchestrator and event bus, not by Growth.
