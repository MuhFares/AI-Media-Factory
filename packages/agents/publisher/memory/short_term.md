# Publisher Agent — Short-Term Memory

Working context for a single publish cycle. Discarded or archived after the asset is handed to Analytics.

## What is stored here

- The current `PublishApproved` package: `asset_id`, `platforms[]`, and `approvals{brand, qa}`.
- Intermediate state for this publish: the approval-check result, per-platform policy screen, the planned schedule, and captured URLs and timestamps.
- The draft `PublishingFinished` event before it is emitted.

## Lifecycle

Populated when a `PublishApproved` event arrives, used through the publish steps in [instructions.md](../prompts/instructions.md), and cleared once the `PublishingFinished` event is emitted to Analytics and the durable outcomes and lessons are written to [long_term.md](./long_term.md). Nothing here is authoritative; it is scratch space for one publish. The hard gate is re-evaluated from the event each run and is never cached as approved.
