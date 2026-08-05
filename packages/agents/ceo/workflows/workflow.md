# CEO Agent — Workflow

How the CEO agent executes within the event-driven pipeline. The CEO sits at the end of each production loop (CEO Review) and at the start of the next (Directive).

## Position in the pipeline

```
... -> Analytics(AnalyticsReported) -> Finance(FinanceReported)
     -> Orchestrator assembles review package
     -> CEO(CEOReviewRequested) --decides--> CEO(ExecutiveDirective)
     -> Orchestrator executes next cycle
```

The CEO never sits on the production path (Research -> ... -> Publisher). It is invoked only to review and to direct.

## Trigger

- **Scheduled:** the Orchestrator emits `CEOReviewRequested` on the weekly review cadence.
- **Event-driven:** a `critical` risk flag or a budget breach can trigger an off-cycle review.

## Execution steps

1. Orchestrator publishes `CEOReviewRequested` with the assembled package.
2. CEO validates the event against `input.schema.json`.
3. CEO runs the decide procedure in [prompts/instructions.md](../prompts/instructions.md).
4. CEO emits exactly one `ExecutiveDirective` (validated against `output.schema.json`) targeted at the Orchestrator.
5. Orchestrator decomposes the directive into workflows for the specialist agents.

## Failure handling

- Invalid or stale input: CEO emits no directive and requests a refreshed package (no partial decisions).
- Escalation trigger hit: CEO pauses and routes to the human operator before emitting.
- Retries and dead-lettering are handled by the Orchestrator and event bus, not the CEO.
