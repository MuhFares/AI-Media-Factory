# Growth Agent — Long-Term Memory

Durable knowledge that persists across runs. Vector-backed; linked to [packages/database](../../database/README.md), [playbooks/](../../../playbooks/README.md), and the [Company Brain](../../../memory/company/README.md).

## What is stored here

- **Experiment ledger.** Every experiment run: its hypothesis, target metric, guardrails, sample size, and measured effect — so a test is never blindly repeated.
- **Effect-size library.** Per-tactic lift and the conditions under which it held or failed to replicate, so wins are applied where they actually work.
- **Playbook registry.** Which tactics were promoted to playbooks/, when, and their production adoption and sustained effect.
- **Expansion history.** Channel and niche proposals made to the CEO, the decision, and the outcome — so future proposals are grounded in what expansion actually delivered.

## How it is used

At the start of each cycle Growth loads the experiment ledger and effect-size library so it proposes tests that build on evidence rather than relearn it. Proven tactics are promoted to playbooks and their sustained effect written back — this is the Compounding Knowledge value applied to growth: a tactic learned once is reused everywhere, and the win rate rises over time.

## Retention

Long-term memory is durable and versioned. Nothing is deleted; superseded tactics are marked as superseded when a better variant replaces them, so the history of what was tried remains interpretable.
