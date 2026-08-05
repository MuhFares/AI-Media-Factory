# Thumbnail Agent — Long-Term Memory

Durable knowledge that persists across runs. Vector-backed; linked to [packages/database](../../database/README.md) and the [Company Brain](../../../memory/company/README.md).

## What is stored here

- **Thumbnail ledger.** Every accepted thumbnail, its brand and topic class, concept, variant set, render cost, and — filled in later — its qualified click-through and variant win rate. This is how design quality is scored.
- **Concept memory.** Visual patterns (composition, subject treatment, color) mapped to measured qualified click-through by brand and niche, so honest, high-performing concepts compound.
- **Cost memory.** Render approaches mapped to actual cost, so the agent chooses cost-effective techniques and avoids repeat overruns.
- **Failure patterns.** Recurring reasons imagery was rejected (bait frames, off-brand visuals, budget overruns) so they are not repeated.

## How it is used

At the start of each run the Thumbnail agent loads the concept memory and cost memory for the target brand and topic class, comparing the current asset against what has already earned qualified clicks within budget. Outcomes are written back so the ledger compounds — this is the Compounding Knowledge value in practice.

## Retention

Long-term memory is durable and versioned. Nothing is deleted; superseded concept and cost patterns are marked, not removed.
