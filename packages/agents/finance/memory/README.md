# Finance Agent — Memory

This folder anchors the finance agent's memory layers:

- **Short-term memory** — the working context of the current reasoning session (e.g., the current reporting period).
- **Long-term memory** — durable financial knowledge persisted in a vector store (historical margins, cost patterns, brand economics), linked to `packages/database`.
- **Episodic memory** — records of past decisions and their outcomes, used for learning and for the metrics computed in `packages/analytics`.

Persisted memory artifacts and snapshots are runtime-generated. This README anchors the folder and documents the memory contract.
