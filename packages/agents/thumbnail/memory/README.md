# Thumbnail Agent — Memory

This folder describes the memory layers available to the thumbnail agent. Memory lets the agent retain context across a session and across the lifetime of the company.

- Short-term memory — the active thumbnail task and its candidate variants.
- Long-term memory — durable knowledge of winning visual patterns and brand styles held in a vector store.
- Episodic memory — records of specific past thumbnails and their click-through outcomes.

These layers link to `packages/database` for persistence and to `packages/analytics` for the click-through history the thumbnail agent reasons over. No memory implementation exists yet; this README anchors the folder and documents its intent.
