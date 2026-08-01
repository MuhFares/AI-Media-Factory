# Research Agent — Memory

This folder describes the memory layers available to the research agent. Memory lets the agent retain context across a session and across the lifetime of the company.

- Short-term memory — the active research task and its in-progress findings.
- Long-term memory — durable knowledge of topics, sources, and prior briefs held in a vector store.
- Episodic memory — records of specific past research efforts and how the resulting content performed.

These layers link to `packages/database` for persistence and to `packages/analytics` for the performance history the research agent reasons over. No memory implementation exists yet; this README anchors the folder and documents its intent.
