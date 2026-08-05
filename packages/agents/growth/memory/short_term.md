# Growth Agent — Short-Term Memory

Working context for a single experiment cycle. Discarded or archived after the proposal is emitted.

## What is stored here

- The current `AnalyticsReported` input and the relevant slice of the A/B-test registry.
- Candidate hypotheses for this cycle: each with its target metric, guardrails, and door classification.
- Interim results from reversible tests running this cycle, and the win/inconclusive verdict per test.
- The draft `GrowthProposed` event before it is emitted.

## Lifecycle

Populated when an `AnalyticsReported` event arrives, used through the experiment steps in [instructions.md](../prompts/instructions.md), and cleared once the `GrowthProposed` event is emitted and durable experiment outcomes and promoted playbooks are written to [long_term.md](./long_term.md) and playbooks/. Nothing here is authoritative; it is scratch space for one cycle.
