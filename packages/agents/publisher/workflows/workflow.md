# Publisher Agent — Workflow

How the Publisher agent executes within the event-driven pipeline. Publisher sits in the production layer, immediately after the Brand + QA gates and before Analytics.

## Position in the pipeline

```
... -> Video(VideoFinished) -> [Brand + QA gates] -> Publisher(PublishApproved)
     -> Publisher(publishes) -> Publisher(PublishingFinished) -> Analytics -> ...
```

Publisher is the last step before the audience. It acts only on an asset that has cleared both gates, and it owns the final content-quality gate: it re-verifies both approvals before any distribution and hands the outcome to Analytics.

## Trigger

- **Event-driven:** the Orchestrator routes a `PublishApproved` event to Publisher once the Brand and QA gates both approve an asset.

## Execution steps

1. Orchestrator routes `PublishApproved` to Publisher.
2. Publisher validates the event against `input.schema.json`.
3. Publisher enforces the hard gate: both `approvals.brand` and `approvals.qa` must be true, or it holds and escalates. This step is never skipped.
4. Publisher screens platform policy, plans the schedule, and distributes to the cleared platforms per [prompts/instructions.md](../prompts/instructions.md).
5. Publisher emits exactly one `PublishingFinished` (validated against `output.schema.json`) targeted at Analytics.
6. Orchestrator routes downstream measurement and feedback.

## Failure handling

- Missing or false approval: Publisher publishes nothing, holds the asset, and escalates to the gate owners. No override exists.
- Platform-policy risk: Publisher escalates to Brand before publishing the affected platform; other cleared platforms may proceed.
- Repeated per-platform failure: Publisher escalates to the Orchestrator and records the platform status rather than retrying indefinitely.
- Retries and dead-lettering of individual publish jobs are handled by the Orchestrator and event bus; Publisher decides only publish eligibility and schedule.
