# Brand Agent — Memory

This folder anchors the Brand agent's memory layers:

- **Short-term memory** — the working context of the current review (the asset under judgment and this cycle's checks).
- **Long-term memory** — durable brand rulings, voice-conformance patterns, and safety precedents persisted in a vector store, linked to [packages/database](../../../database/README.md).
- **Episodic memory** — a record of past rulings and their production outcomes, feeding the metrics computed in [packages/analytics](../../../analytics/README.md).

Persisted memory artifacts and snapshots are runtime-generated. This README anchors the folder and documents the memory contract. See [long_term.md](./long_term.md) and [short_term.md](./short_term.md).
