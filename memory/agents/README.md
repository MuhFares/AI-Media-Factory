# Agent Memory

Per-agent persisted memory stores for AI Media Factory. Each agent maintains its own durable memory state here.

Contents are runtime-generated and git-ignored; this README and .gitkeep anchor the folder in version control.

## What lives here

- Short-term memory snapshots: recent working context captured for continuity.
- Long-term memory stores: consolidated knowledge and preferences an agent retains across sessions.
- Episodic memory snapshots: time-ordered records of an agent's decisions, actions, and observed outcomes for later replay.

Records are organized per agent so that an individual agent's state can be inspected, restored, or migrated independently.
