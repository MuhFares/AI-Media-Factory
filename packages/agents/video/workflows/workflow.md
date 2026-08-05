# Video Agent — Workflow

How the Video agent executes within the event-driven pipeline. Video sits in the production layer, between Thumbnail and the Brand + QA gates.

## Position in the pipeline

```
... -> Thumbnail(ThumbnailFinished) -> Video(renders) -> Video(VideoFinished)
     -> [Brand + QA gates] -> Publisher -> Analytics -> ...
```

Video is on the production path. It consumes the upstream thumbnail-and-concept package and hands a finished asset to the QA gate; it never publishes and never advances an asset past a gate on its own.

## Trigger

- **Event-driven:** the Orchestrator routes a `ThumbnailFinished` event to Video when the thumbnail stage completes for an asset.

## Execution steps

1. Orchestrator routes `ThumbnailFinished` to Video.
2. Video validates the event against `input.schema.json` and resolves approved sources.
3. Video runs the render procedure in [prompts/instructions.md](../prompts/instructions.md), estimating cost before dispatch.
4. Video dispatches the heavy render to apps/worker via packages/media (FFmpeg) and generates captions.
5. Video emits exactly one `VideoFinished` (validated against `output.schema.json`) targeted at QA.
6. Orchestrator routes the asset through the Brand + QA gates before Publisher.

## Failure handling

- Invalid or unapproved input: Video renders nothing and returns the event for correction (no partial assets).
- Cost overrun: Video escalates to Finance before dispatching the render and waits for authorization.
- Repeated fatal render error or unusable source: Video escalates the quality failure to QA with diagnostics; it does not forward a broken asset.
- Retries and dead-lettering of the render job are handled by the Orchestrator and apps/worker, not by Video.
