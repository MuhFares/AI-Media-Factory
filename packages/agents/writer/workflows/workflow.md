# Writer Agent — Workflow

How the Writer agent executes within the event-driven pipeline. The Writer is the first language-producing stage of the production loop.

## Position in the pipeline

```
... -> Research(ResearchFinished)
     -> Writer(consumes ResearchFinished) --writes--> Writer(ScriptFinished)
     -> SEO(consumes ScriptFinished) -> ...
     -> [Brand + QA gates] may intercept before advance
```

The Writer sits between Research and SEO on the production path. It never sets strategy and never optimizes for discovery.

## Trigger

- **Event-driven:** the Orchestrator routes a `ResearchFinished` event to the Writer once a brief clears Research.
- **Re-run:** a Brand or QA rejection returns the script to the Writer with notes for revision.

## Execution steps

1. Orchestrator delivers `ResearchFinished` with the brief.
2. Writer validates the event against `input.schema.json`.
3. Writer runs the write procedure in [prompts/instructions.md](../prompts/instructions.md).
4. Writer emits exactly one `ScriptFinished` event (validated against `output.schema.json`) targeted at the SEO agent.
5. Brand and QA gates may intercept the script before it advances; on rejection it returns for revision.

## Failure handling

- Invalid or incomplete brief: Writer emits no script and requests a corrected brief (no partial writing).
- Off-voice or unverifiable-claim trigger hit: Writer pauses and escalates to Brand/QA before emitting.
- Retries and dead-lettering are handled by the Orchestrator and event bus, not the Writer.
