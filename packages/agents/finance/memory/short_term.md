# Finance Agent — Short-Term Memory

Working context for a single unit-economics cycle. Discarded or archived after the report is emitted.

## What is stored here

- The current `AnalyticsReported` input: asset metrics, attributed revenue, and its confidence.
- Intermediate computation: the reconciliation result, the assembled cost breakdown, derived gross margin and AGP contribution.
- The Margin-gate verdict, budget-status check, and any draft routing recommendation for this cycle.
- The draft `FinanceReported` event before it is emitted.

## Lifecycle

Populated when an `AnalyticsReported` event arrives, used through the control steps in [instructions.md](../prompts/instructions.md), and cleared once the `FinanceReported` event is emitted and durable cost curves, budget ledger entries, and routing outcomes are written to [long_term.md](./long_term.md). Nothing here is authoritative; it is scratch space for one cycle.
