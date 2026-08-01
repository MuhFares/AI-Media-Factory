# Video Agent — Memory

This folder describes the memory layers available to the video agent. Memory lets the agent retain context across a session and across the lifetime of the company.

- Short-term memory — the active render job and its timeline context.
- Long-term memory — durable knowledge of editing styles, pacing patterns, and asset libraries held in a vector store.
- Episodic memory — records of specific past renders and how the resulting videos performed.

These layers link to `packages/database` for persistence and to `packages/analytics` for the retention history the video agent reasons over. No memory implementation exists yet; this README anchors the folder and documents its intent.
