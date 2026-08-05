# Publisher Agent — Memory

This folder describes the memory layers available to the publisher agent. Memory lets the agent retain context across a session and across the lifetime of the company.

- Short-term memory — the active publish task and its per-platform upload state.
- Long-term memory — durable knowledge of platform behavior, format requirements, and posting history held in a vector store.
- Episodic memory — records of specific past publications and their delivery outcomes.

These layers link to `packages/database` for persistence and to `packages/analytics` for the reach and distribution history the publisher agent reasons over. No memory implementation exists yet; this README anchors the folder and documents its intent.
