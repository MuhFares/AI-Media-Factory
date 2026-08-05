# Research Agent — Long-Term Memory

Durable knowledge that persists across runs. Vector-backed; linked to [packages/database](../../database/README.md) and the [Company Brain](../../../memory/company/README.md).

## What is stored here

- **Topic performance ledger.** Every researched topic, its predicted demand at the time, and — filled in later from Analytics — its measured views and revenue per asset. This is how demand prediction is scored.
- **Source reliability index.** Sources seen across briefs, their credibility, and how often their claims held up downstream.
- **Covered-topic map.** Topics already produced per brand, to avoid cannibalization and detect saturation.
- **Angle and keyword lessons.** Which angles and keyword clusters correlated with high revenue per asset for each brand.

## How it is used

At the start of each run the Research agent loads the topic performance ledger and source reliability index so it can favor demand patterns and sources that proved out, avoid recently covered topics, and reuse winning angles. Measured outcomes are written back so demand prediction compounds — this is the Compounding Knowledge value applied to discovery.

## Retention

Long-term memory is durable and versioned. Superseded demand reads and retired topics are marked, not deleted, so a wrong prediction can be traced to the evidence that motivated it.
