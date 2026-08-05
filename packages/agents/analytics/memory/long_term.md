# Analytics Agent — Long-Term Memory

Durable knowledge that persists across runs. Vector-backed; linked to [packages/database](../../database/README.md), [knowledge/](../../../knowledge/README.md), and the [Company Brain](../../../memory/company/README.md).

## What is stored here

- **Benchmark library.** Per-brand and per-format baselines for each metric (views, watch time, ctr, retention, conversions) so new results are judged against history, not in isolation.
- **Attribution method registry.** Every attribution model version, when it changed, and why — so revenue figures stay comparable across cycles.
- **Insight lessons.** Distilled, reusable findings ("cold opens under 3s lift retention on shorts") written alongside their evidence, mirrored to knowledge/.
- **Data-quality ledger.** Recurring feed outages, tracking breaks, and attribution gaps, so systemic measurement problems are visible over time.

## How it is used

At the start of each cycle Analytics loads the relevant benchmarks and the current attribution method version, so a report is always framed against a stable baseline. Confirmed lessons are written back and mirrored to knowledge/ — this is the Compounding Knowledge value in practice: the company measures better each cycle than the last.

## Retention

Long-term memory is durable and versioned. Nothing is deleted; superseded benchmarks and attribution methods are marked as superseded, not removed, so historical reports remain interpretable.
