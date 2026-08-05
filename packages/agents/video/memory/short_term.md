# Video Agent — Short-Term Memory

Working context for a single render cycle. Discarded or archived after the asset is handed to QA.

## What is stored here

- The current `ThumbnailFinished` package: `thumbnail_asset_ref`, `variants[]`, and `concept`, plus the resolved script, audio, and source-visual references.
- Intermediate state for this render: the chosen edit plan, the cost estimate, the render profile, and worker job identifiers.
- The draft `VideoFinished` event before it is emitted.

## Lifecycle

Populated when a `ThumbnailFinished` event arrives, used through the render steps in [instructions.md](../prompts/instructions.md), and cleared once the `VideoFinished` event is emitted to QA and the durable render profile, actual cost, and lessons are written to [long_term.md](./long_term.md). Nothing here is authoritative; it is scratch space for one render.
