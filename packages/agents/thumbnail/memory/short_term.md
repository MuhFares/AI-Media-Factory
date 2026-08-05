# Thumbnail Agent — Short-Term Memory

Working context for a single thumbnail run. Discarded or archived after the run closes.

## What is stored here

- The current `SEOFinished` input: title, description, tags, keywords, chapters, metadata.
- Intermediate reasoning for this run: concept candidates, estimated and actual render cost, variant renders, honesty- and safety-check results.
- The draft `ThumbnailFinished` payload before it is emitted.

## Lifecycle

Populated when an optimized asset arrives, used through the design steps in [instructions.md](../prompts/instructions.md), and cleared once the `ThumbnailFinished` event is emitted and the durable summary is written to [long_term.md](./long_term.md). Nothing here is authoritative; it is scratch space for one run.
