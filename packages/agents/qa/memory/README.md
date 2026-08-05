# QA Agent — Memory

This folder describes the memory layers available to the QA agent. Memory lets the agent retain context across a single review and across the lifetime of the company.

- Short-term memory — the current asset under review and the results of each check.
- Long-term memory — durable defect patterns and per-agent defect history held in a vector store.
- Episodic memory — records of specific past holds and how they were resolved, for later recall.

These layers link to `packages/database` for persistence and to `packages/analytics` for the defect and escape-rate history the QA agent reasons over. No memory implementation exists yet; this README anchors the folder and documents its intent.
