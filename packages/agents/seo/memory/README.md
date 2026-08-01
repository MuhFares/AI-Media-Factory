# SEO Agent — Memory

This folder describes the memory layers available to the SEO agent. Memory lets the agent retain context across a session and across the lifetime of the company.

- Short-term memory — the active optimization task and its candidate metadata.
- Long-term memory — durable knowledge of keywords, ranking history, and platform algorithm behavior held in a vector store.
- Episodic memory — records of specific past optimizations and their ranking outcomes.

These layers link to `packages/database` for persistence and to `packages/analytics` for the ranking and traffic history the SEO agent reasons over. No memory implementation exists yet; this README anchors the folder and documents its intent.
