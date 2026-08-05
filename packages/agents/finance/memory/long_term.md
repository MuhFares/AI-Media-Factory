# Finance Agent — Long-Term Memory

Durable knowledge that persists across runs. Vector-backed; linked to [packages/database](../../database/README.md) and the [Company Brain](../../../memory/company/README.md).

## What is stored here

- **Cost-curve library.** Per-brand and per-format cost curves (model, render, storage, distribution) so each new asset's economics are judged against history.
- **Budget ledger.** The CEO-allocated caps per brand and agent, spend against them over time, and every enforcement action taken.
- **Routing-outcome registry.** Each model-routing recommendation, the expected saving, and the realized contribution effect — so routing advice improves with evidence.
- **Margin-gate record.** Assets and brands flagged for negative unit economics, and any CEO investment rationale that permitted a temporary negative margin.

## How it is used

At the start of each cycle Finance loads the relevant cost curve and current budget caps, so a margin verdict is always framed against the brand's real economics and the allocation in force. Routing outcomes are written back so recommendations compound — this is the Compounding Knowledge value applied to unit economics: the company gets cheaper to run per profitable asset over time.

## Retention

Long-term memory is durable and versioned. Nothing is deleted; superseded caps and cost curves are marked as superseded, not removed, so historical margin verdicts remain interpretable.
