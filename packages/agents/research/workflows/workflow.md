# Research Agent — Workflow

How the Research agent executes within the event-driven pipeline. Research is the first production stage; it turns a dispatched topic into the evidence-backed brief every downstream stage depends on.

## Position in the pipeline

```
CEO(Directive) -> Orchestrator(TaskDispatched) -> Research(ResearchFinished)
   -> Writer -> SEO -> Thumbnail -> Video
   -> [Brand + QA gates] -> Publisher -> Analytics -> Finance -> CEO Review
```

The `ResearchFinished` event this agent emits is exactly the `WriterStarted` input the Writer consumes. Research does not write, render, or publish; it validates and hands off.

## Trigger

- **Dispatch-driven:** the Orchestrator emits `TaskDispatched` with stage `research` for a given `brand_id` and topic seed.

## Execution steps

1. Consume the `TaskDispatched` event and validate it against `input.schema.json`.
2. Run the research-and-validate procedure in [prompts/instructions.md](../prompts/instructions.md): assess demand, gather sources, screen for safety, extract key points, choose an angle, generate keyword seeds.
3. Apply the Evidence gate: confirm validated demand and at least the minimum credible sources.
4. Emit exactly one `ResearchFinished` (validated against `output.schema.json`) targeted at the Writer.
5. Report completion to the Orchestrator so the workflow advances to the Writer stage.

## Failure handling

- Thin/contradictory evidence or no credible demand signal: emit no brief; flag the topic and escalate to the Orchestrator requesting a different topic.
- Brand-safety or compliance risk: flag and escalate; never forward a risky topic for reach.
- Transient tool/retrieval failure: reported to the Orchestrator, which owns retries and dead-lettering. The Research agent does not manage its own retry budget.
