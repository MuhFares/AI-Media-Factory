# Session Memory

Session Memory holds the working state of a single workflow run, keyed by `workflow_id`: the events exchanged between agents, intermediate artifacts, and the run's context. It is the ephemeral, per-run scope in the [Memory Architecture](../../docs/architecture/memory-architecture.md).

Contents are runtime-generated and git-ignored; this README and `.gitkeep` anchor the folder in version control.

## Owner

The [Orchestrator](../../packages/agents/orchestrator/README.md) owns session memory, because it owns run coordination. Every agent in a run contributes to the session through events, but only the Orchestrator manages its lifecycle.

## What belongs here

- The ordered events of a run (`workflow_id`, `event_id` keyed), for full traceability.
- Intermediate artifacts produced during the run.
- The run's transient context.

Resumable checkpoints for long-running work live separately in [`../checkpoints/`](../checkpoints/README.md).

## Lifecycle

Created when a workflow starts, appended to as the run progresses, and closed when the run completes or dead-letters.

## Update rules

Append-only during the run; keyed by `workflow_id` and `event_id`. Not authoritative — durable outcomes are promoted to [Analytics Memory](../analytics/README.md) and [Lessons Learned](../../knowledge/lessons/README.md) before the session is expired.

## Archival rules

On completion, the session is summarized (durable takeaways promoted), then the raw session is expired after 30 days and purged. Dead-lettered sessions are retained longer for diagnosis. See the global archival table in the [Memory Architecture](../../docs/architecture/memory-architecture.md).
