# SEO Agent — Workflow

How the SEO agent executes within the event-driven pipeline. The SEO agent is the discovery stage between writing and imagery.

## Position in the pipeline

```
... -> Writer(ScriptFinished)
     -> SEO(consumes ScriptFinished) --optimizes--> SEO(SEOFinished)
     -> Thumbnail(consumes SEOFinished) -> ...
     -> [Brand + QA gates] may intercept before advance
```

The SEO agent sits between the Writer and the Thumbnail agent on the production path. It never rewrites the script and never drifts the voice.

## Trigger

- **Event-driven:** the Orchestrator routes a `ScriptFinished` event to the SEO agent once a script clears the Writer.
- **Re-run:** a Brand or QA rejection returns the metadata to the SEO agent with notes for revision.

## Execution steps

1. Orchestrator delivers `ScriptFinished` with the finished script.
2. SEO validates the event against `input.schema.json` and confirms `brand_voice_applied` is true.
3. SEO runs the optimize procedure in [prompts/instructions.md](../prompts/instructions.md).
4. SEO emits exactly one `SEOFinished` event (validated against `output.schema.json`) targeted at the Thumbnail agent.
5. Brand and QA gates may intercept the metadata before it advances; on rejection it returns for revision.

## Failure handling

- Invalid input or `brand_voice_applied` not true: SEO emits no metadata and returns the asset (no optimization of an unapproved script).
- Click-bait or off-voice trigger hit: SEO pauses and escalates to Brand before emitting.
- Retries and dead-lettering are handled by the Orchestrator and event bus, not the SEO agent.
