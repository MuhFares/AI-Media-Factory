# CEO Agent — Long-Term Memory

Durable knowledge that persists across runs. Vector-backed; linked to [packages/database](../../database/README.md) and the [Company Brain](../../../memory/company/README.md).

## What is stored here

- **Decision ledger.** Every one-way-door decision the CEO has made, its rationale, the evidence at the time, and — filled in later — the measured result. This is how decision quality is scored.
- **Strategy history.** Successive strategic directions and why they changed.
- **Brand portfolio memory.** Per-brand history: launched, invested, killed, and the economics that drove each call.
- **Institutional lessons.** Patterns that repeat across cycles (e.g., which niches sustain margin, which agent bottlenecks recur).

## How it is used

At the start of each review the CEO loads the decision ledger to avoid relearning past lessons and to compare current proposals against what has already been tried. Outcomes are written back so the ledger compounds — this is the Compounding Knowledge value in practice.

## Retention

Long-term memory is durable and versioned. Nothing is deleted; superseded strategy is marked, not removed.
