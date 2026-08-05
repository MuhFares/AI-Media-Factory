# Memory

This directory is the durable memory layer for AI Media Factory: the persisted long-term brain state of the company and its agents.

Contents are runtime-generated and git-ignored; this README and .gitkeep anchor the folder in version control.

## Distinction from packages/database

`packages/database` is the access layer: the schemas, clients, and query interfaces used to read and write data. This `memory` directory is the persisted state and artifact layer: the concrete snapshots, checkpoints, and accumulated knowledge that the platform produces at runtime. The database defines how memory is reached; this folder holds what has actually been remembered.

## What lives here

This layer retains vector-store snapshots (embeddings and index state exported for durability) and episodic memory (time-ordered records of events, decisions, and outcomes that agents replay to inform future behavior).

## Subfolders

| Subfolder | Purpose |
| --- | --- |
| company | Company-level long-term memory: mission state, strategy history, brand definitions, institutional knowledge. |
| agents | Per-agent persisted memory stores: short-term, long-term, and episodic snapshots. |
| analytics | Persisted analytical memory: rolling metrics and learned performance patterns. |
| reports | Generated executive and analytics reports archive. |
| checkpoints | Workflow and agent checkpoints enabling resume, replay, and recovery. |
