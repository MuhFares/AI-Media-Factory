# Thumbnail Agent — Workflow

How the Thumbnail agent executes within the event-driven pipeline. The Thumbnail agent is the cover-imagery stage between discovery optimization and video assembly.

## Position in the pipeline

```
... -> SEO(SEOFinished)
     -> Thumbnail(consumes SEOFinished) --designs+renders--> Thumbnail(ThumbnailFinished)
     -> Video(consumes ThumbnailFinished) -> ...
     -> [Brand + QA gates] may intercept before advance
```

The Thumbnail agent sits between the SEO agent and the Video agent on the production path. It never writes copy and never edits the video.

## Trigger

- **Event-driven:** the Orchestrator routes a `SEOFinished` event to the Thumbnail agent once metadata clears the SEO agent.
- **Re-run:** a Brand or QA rejection, or a variant-test request from Growth, returns the asset for new variants.

## Execution steps

1. Orchestrator delivers `SEOFinished` with the title, description, and chapters.
2. Thumbnail validates the event against `input.schema.json`.
3. Thumbnail runs the design procedure in [prompts/instructions.md](../prompts/instructions.md), checking the render budget before rendering.
4. Thumbnail emits exactly one `ThumbnailFinished` event (validated against `output.schema.json`) targeted at the Video agent.
5. Brand and QA gates may intercept the imagery before it advances; on rejection it returns for revision.

## Failure handling

- Invalid input: Thumbnail emits no imagery and returns the asset (no rendering against an invalid brief).
- Render-cost overrun: Thumbnail reduces scope or escalates to Finance before rendering.
- Click-bait or brand-safety concern: Thumbnail pauses and escalates to Brand before emitting.
- Retries and dead-lettering are handled by the Orchestrator and event bus, not the Thumbnail agent.
