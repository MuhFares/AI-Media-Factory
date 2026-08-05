# QA Agent — Short-Term Memory

Working context for a single quality-gate review. Discarded or archived after the verdict is emitted.

## What is stored here

- The current `VideoFinished` event: `asset_id`, `video_asset_ref`, `duration_seconds`, `captions_ref`.
- Intermediate results for this review: each check's outcome, probe output, and the draft defect list.
- The draft `QAReviewed` verdict before it is emitted.

## Lifecycle

Populated when a review begins, used through the check steps in [instructions.md](../prompts/instructions.md), and cleared once the `QAReviewed` event is emitted and the durable defects are written to [long_term.md](./long_term.md). Nothing here is authoritative; it is scratch space for one review.
