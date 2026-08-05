# Analytics Agent — Workflow

How the Analytics agent executes within the event-driven pipeline. Analytics sits on the feedback layer, at the point where a published asset first produces measurable results.

## Position in the pipeline

```
... -> Publisher(PublishingFinished) -> Analytics(AnalyticsReported)
     -> Finance(FinanceReported) -> Growth(GrowthProposed)
     -> Orchestrator assembles review package -> CEO Review
```

Analytics never sits on the production path (Research -> ... -> Publisher). It is invoked only after publication, to measure and to report the evidence the feedback layer compounds.

## Trigger

- **Event-driven:** the Publisher emits `PublishingFinished` when an asset is live across its references.
- **Scheduled re-measurement:** the Orchestrator may re-trigger a cycle to capture later-window performance (e.g. 7-day retention) against the same asset.

## Execution steps

1. Publisher publishes `PublishingFinished` with the asset id and its published references.
2. Analytics validates the event against `input.schema.json`.
3. Analytics runs the measure procedure in [prompts/instructions.md](../prompts/instructions.md): collect, compute, attribute, distill.
4. Analytics writes reusable lessons to knowledge/ and records the reference.
5. Analytics emits exactly one `AnalyticsReported` (validated against `output.schema.json`) targeted at the Finance agent.

## Failure handling

- Missing or unresolvable references: Analytics reports the resolvable subset, marks missing metrics null, and escalates a `data_quality_gap`.
- Revenue not attributable above threshold: Analytics reports engagement metrics and raises an `attribution_gap`; it does not assert an unsupported figure.
- Retries and dead-lettering are handled by the Orchestrator and event bus, not by Analytics.
