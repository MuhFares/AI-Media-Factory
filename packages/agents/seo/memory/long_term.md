# SEO Agent — Long-Term Memory

Durable knowledge that persists across runs. Vector-backed; linked to [packages/database](../../database/README.md) and the [Company Brain](../../../memory/company/README.md).

## What is stored here

- **Metadata ledger.** Every accepted set of title, description, tags, and keywords, its brand and topic class, and — filled in later — its click-through, ranking, and retention-after-click outcomes. This is how optimization quality is scored.
- **Keyword memory.** Terms mapped to measured ranking opportunity and conversion by brand and niche, so productive keywords compound.
- **Title pattern library.** Title framings mapped to qualified click-through and to retention-after-click, so honest, high-performing patterns are reused and click-bait patterns are avoided.
- **Failure patterns.** Recurring reasons metadata was rejected (overstated titles, stuffing, off-voice drift) so they are not repeated.

## How it is used

At the start of each run the SEO agent loads the keyword memory and title pattern library for the target brand and topic class, comparing the current script against what has already ranked honestly. Outcomes are written back so the ledger compounds — this is the Compounding Knowledge value in practice.

## Retention

Long-term memory is durable and versioned. Nothing is deleted; superseded keyword and title patterns are marked, not removed.
