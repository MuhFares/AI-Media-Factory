# Queue

Durable queue spool for the AI Media Factory platform. This folder holds job payloads and spooled messages for the task queue and event bus, providing a persistent working area for in-flight and pending work.

Contents are runtime-generated and git-ignored; this README and .gitkeep anchor the folder.

## Characteristics

- Stores serialized job payloads awaiting or undergoing processing.
- Backs the task queue and event bus for at-least-once delivery semantics.
- Contents reflect operational state and should not be edited by hand.
