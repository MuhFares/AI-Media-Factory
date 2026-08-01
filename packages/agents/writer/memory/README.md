# Writer Agent — Memory

This folder describes the memory layers available to the writer agent. Memory lets the agent retain context across a session and across the lifetime of the company.

- Short-term memory — the active draft and its revision context.
- Long-term memory — durable knowledge of brand voice, style rules, and prior scripts held in a vector store.
- Episodic memory — records of specific past pieces and how they performed.

These layers link to `packages/database` for persistence and to `packages/analytics` for the performance history the writer agent reasons over. No memory implementation exists yet; this README anchors the folder and documents its intent.
