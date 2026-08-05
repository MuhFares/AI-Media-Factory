# Brand Agent — Short-Term Memory

Working context for a single brand-gate review. Discarded or archived after the ruling is emitted.

## What is stored here

- The current `QAReviewed` input and the asset references it points to.
- Intermediate reasoning for this review: safety findings, citation checks, voice-conformance scoring, packaging-honesty check.
- The draft `PublishApproved` verdict (or the HOLD and its escalation target) before it is emitted.

## Lifecycle

Populated when a review begins, used through the steps in [instructions.md](../prompts/instructions.md), and cleared once the verdict is emitted and the durable ruling is written to [long_term.md](./long_term.md). Nothing here is authoritative; it is scratch space for one review.
