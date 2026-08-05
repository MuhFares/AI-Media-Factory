# CEO Agent — Short-Term Memory

Working context for a single review-and-decide cycle. Discarded or archived after the cycle closes.

## What is stored here

- The current `CEOReviewRequested` package: KPI snapshot, analytics and finance summaries, risk flags.
- Intermediate reasoning for this cycle: candidate initiatives, RICE scores, gate results.
- The draft directive before it is emitted.

## Lifecycle

Populated when a review begins, used through the decision steps in [instructions.md](../prompts/instructions.md), and cleared once the `ExecutiveDirective` is emitted and the durable decisions are written to [long_term.md](./long_term.md). Nothing here is authoritative; it is scratch space for one cycle.
