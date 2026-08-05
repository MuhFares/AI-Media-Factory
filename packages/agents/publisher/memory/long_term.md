# Publisher Agent — Long-Term Memory

Durable knowledge that persists across runs. Vector-backed; linked to [packages/database](../../database/README.md) and the [Company Brain](../../../memory/company/README.md).

## What is stored here

- **Per-platform timing patterns.** The publish windows that have historically produced the best reach per brand and platform, used to plan schedules.
- **Platform policy history.** Known per-platform rules, rate limits, and past policy incidents, so risky content is caught before it is published.
- **Publish outcome ledger.** Where and when each asset was published and its delivery status, used to measure schedule adherence and success rate.
- **Failure patterns.** Recurring per-platform failure modes and the responses that resolved them.

## How it is used

At the start of each publish the Publisher loads platform timing patterns and policy history so it schedules into proven windows and screens for policy risk before distributing. Outcomes are written back so the timing and policy knowledge compounds — this is the Compounding Knowledge value in practice. The hard gate (both approvals required) is never learned around; it is enforced every run regardless of history.

## Retention

Long-term memory is durable and versioned. Superseded platform rules are marked deprecated, not deleted, so past publishes remain auditable.
