# Growth Agent — Memory

This folder anchors the growth agent's memory layers:

- **Short-term memory** — the working context of the current optimization session.
- **Long-term memory** — durable knowledge of what has and has not worked (winning hooks, format patterns), persisted in a vector store linked to `packages/database`.
- **Episodic memory** — a record of past experiments and outcomes, feeding the metrics computed in `packages/analytics`.

Persisted memory artifacts and snapshots are runtime-generated. This README anchors the folder and documents the memory contract.
