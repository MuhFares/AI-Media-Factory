# Analytics Agent — Memory

This folder describes the memory layers available to the analytics agent. Memory lets the agent retain context across a session and across the lifetime of the company.

- Short-term memory — the active analysis task and the metrics currently under review.
- Long-term memory — durable knowledge of performance trends, benchmarks, and attribution models held in a vector store.
- Episodic memory — records of specific past reports and the decisions they informed.

These layers link to `packages/database` for persistence and to `packages/analytics` for the metrics and revenue history the analytics agent reasons over. No memory implementation exists yet; this README anchors the folder and documents its intent.
