# Research Agent — Short-Term Memory

Working context for a single research-and-validate cycle, keyed by `workflow_id`. Discarded or archived after the brief is emitted or flagged.

## What is stored here

- The current `TaskDispatched` task: topic seed, `brand_id`, and any constraints from the Orchestrator.
- Intermediate findings for this cycle: demand signals pulled, candidate sources, extracted key points, and ICE-scored angle options.
- The draft `ResearchFinished` brief before it is emitted.

## Lifecycle

Populated when a research task arrives, used through the validate-and-synthesize steps in [instructions.md](../prompts/instructions.md), and cleared once the `ResearchFinished` event is emitted (or the topic is flagged and escalated) and the durable topic/source records are written to [long_term.md](./long_term.md). Nothing here is authoritative; it is scratch space for one brief.
