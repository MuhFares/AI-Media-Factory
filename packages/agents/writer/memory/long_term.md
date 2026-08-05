# Writer Agent — Long-Term Memory

Durable knowledge that persists across runs. Vector-backed; linked to [packages/database](../../database/README.md) and the [Company Brain](../../../memory/company/README.md).

## What is stored here

- **Script ledger.** Every accepted script, its brand, hook, section structure, and — filled in later — its retention and acceptance outcomes. This is how writing quality is scored over time.
- **Voice memory.** Per-brand phrasing patterns that passed the Brand gate and those that were rejected, so the Writer converges on each brand's authorized voice.
- **Hook library.** Hook framings mapped to measured first-thirty-second retention, so proven openings compound.
- **Failure patterns.** Recurring reasons scripts were sent back (unsupported claims, off-voice drift, weak pacing) so they are not repeated.

## How it is used

At the start of each run the Writer loads the voice memory for the target brand and the hook library for the topic class, comparing the current brief against what has already worked. Outcomes are written back so the ledger compounds — this is the Compounding Knowledge value in practice.

## Retention

Long-term memory is durable and versioned. Nothing is deleted; superseded voice patterns are marked, not removed.
