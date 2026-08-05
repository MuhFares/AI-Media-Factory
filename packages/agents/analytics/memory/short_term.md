# Analytics Agent — Short-Term Memory

Working context for a single measure-and-report cycle. Discarded or archived after the report is emitted.

## What is stored here

- The current `PublishingFinished` trigger: the asset id and its published references.
- Raw performance pulled per reference this cycle, with collection time and source per metric.
- Intermediate computation: the derived metric set, the attribution result and its confidence, and draft insights.
- The draft `AnalyticsReported` event before it is emitted.

## Lifecycle

Populated when a `PublishingFinished` event arrives, used through the measurement steps in [instructions.md](../prompts/instructions.md), and cleared once the `AnalyticsReported` event is emitted and durable benchmarks and lessons are written to [long_term.md](./long_term.md) and knowledge/. Nothing here is authoritative; it is scratch space for one cycle.
