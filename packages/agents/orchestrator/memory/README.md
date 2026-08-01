# Orchestrator Agent — Memory

This folder describes the memory layers available to the orchestrator agent. Memory lets the agent retain context across a session and across the lifetime of the company.

- Short-term memory — the active workflow run and its in-flight task context.
- Long-term memory — durable knowledge of workflow patterns and routing strategies held in a vector store.
- Episodic memory — records of specific past runs and their outcomes for later recall.

These layers link to `packages/database` for persistence and to `packages/analytics` for the execution history the orchestrator reasons over. No memory implementation exists yet; this README anchors the folder and documents its intent.
