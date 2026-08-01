# CEO Agent — Memory

This folder describes the memory layers available to the CEO agent. Memory lets the agent retain context across a session and across the lifetime of the company.

- Short-term memory — the active conversation and current decision context.
- Long-term memory — durable strategic knowledge and prior decisions held in a vector store.
- Episodic memory — records of specific past initiatives and their outcomes for later recall.

These layers link to `packages/database` for persistence and to `packages/analytics` for the performance history the CEO reasons over. No memory implementation exists yet; this README anchors the folder and documents its intent.
