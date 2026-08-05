# Cache

Transient cache for the AI Media Factory platform. This folder stores short-lived working data that can be regenerated at any time, including cached API responses, an embeddings cache, and intermediate computations produced during workflow execution.

Contents are runtime-generated and git-ignored; this README and .gitkeep anchor the folder.

## Characteristics

- Data here is disposable and safe to purge; it will be recomputed on demand.
- Entries may be subject to time-to-live expiry and eviction policies.
- Do not rely on cache contents for durable state.
