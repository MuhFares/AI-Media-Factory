# Caching Strategy

> Design only. No logic. How the Memory Engine caches to keep retrieval cheap without ever serving stale truth.

| Cache | Holds | Keyed by | Invalidated when |
|---|---|---|---|
| Embedding cache | text → vector | text + embedding-model version | embedding model changes |
| Retrieval cache | (agent, query) → ranked memory ids | agent + query + corpus version | any candidate record is updated / superseded / expired |
| Hot-memory cache | frequently-read Company/Lessons records | memory_id + version | the source record is superseded |

## Rules

- **Version-keyed:** every cache key includes the record/corpus version, so a superseded or expired record is **never** served from cache.
- **No cross-turn caching of ephemeral memory:** session/short-term memory is scoped to one run and is not cached across turns.
- **Confidence-aware:** cached results carry their confidence; a confidence recalibration invalidates affected entries.
- **Bounded:** caches are size-bounded with LRU eviction; caching never changes correctness, only latency.

The cache is an optimization layer under the retrieval pipeline — it can be disabled entirely without changing any result, only its speed.
