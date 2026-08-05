# Orchestrator Agent — Long-Term Memory

Durable knowledge that persists across runs. Vector-backed; linked to [packages/database](../../database/README.md) and the [Company Brain](../../../memory/company/README.md).

## What is stored here

- **Routing playbooks.** Proven stage sequences per content type and brand, and the conditions under which a variant sequence performs better.
- **Failure pattern library.** Recurring transient vs permanent failures per agent, their signatures, and the retry/backoff settings that resolve them.
- **Dead-letter history.** Every task that exhausted its retry budget, its failure history, and the resolution once escalated. This is how bottlenecks are found.
- **Throughput and autonomy baselines.** Per-stage latency, retries-to-success, and Autonomy Rate trends used to detect drift.

## How it is used

At the start of each run the Orchestrator loads routing playbooks and the failure pattern library so it re-dispatches known-transient failures without escalating and routes known content types along their best sequence. Outcomes are written back so routing compounds — this is the Compounding Knowledge value applied to execution reliability.

## Retention

Long-term memory is durable and versioned. Superseded playbooks are marked, not deleted, so a regression can be traced to the routing change that caused it.
