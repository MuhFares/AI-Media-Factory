# Orchestrator Agent — Short-Term Memory

Working context for a single workflow run, keyed by `workflow_id`. Discarded or archived after the workflow completes or is dead-lettered.

## What is stored here

- Live workflow state: current stage, target agent, `brand_id`, and the correlation ids for this run.
- Per-task retry counters and backoff timers.
- The in-flight `TaskDispatched` event awaiting a completion or failure reply.
- The pending gate status (Brand/QA) for an asset that has not yet advanced.

## Lifecycle

Populated when a workflow starts (an `ExecutiveDirective` decomposes into its first task), updated at every completion or failure event through the steps in [instructions.md](../prompts/instructions.md), and cleared once the workflow completes, is dead-lettered, or is checkpointed for resume. Nothing here is authoritative; durable routing outcomes are written to [long_term.md](./long_term.md), and resumable state is persisted to [checkpoints](../../../memory/checkpoints/README.md).
