# QA Agent — Long-Term Memory

Durable knowledge that persists across runs. Vector-backed; linked to [packages/database](../../database/README.md) and the [Company Brain](../../../memory/company/README.md).

## What is stored here

- **Defect ledger.** Every HOLD the QA agent has issued, the check that failed, its severity, and — filled in later — how it was resolved and whether it recurred. This is how defect quality is scored.
- **Defect patterns.** Recurring failure modes by producing agent and format (e.g., which pipeline stage repeatedly ships truncated renders or drops captions).
- **Bounds history.** Learned duration and format expectations per brand and platform, refined as formats evolve.
- **Escape records.** Defects that passed the gate and were caught downstream, so the gate can be tightened where it leaked.

## How it is used

At the start of each review the QA agent loads known defect patterns for the producing agent and format so it can inspect where failures are most likely and catch them earlier. Outcomes are written back so the ledger compounds — this is the Compounding Knowledge value in practice: the gate gets sharper over time rather than drifting.

## Retention

Long-term memory is durable and versioned. Nothing is deleted; superseded bounds and resolved patterns are marked, not removed.
