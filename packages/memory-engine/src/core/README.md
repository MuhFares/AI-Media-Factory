# Core

> Contracts only — declarations, no logic.

| File | Defines |
|---|---|
| `common.ts` | `AgentId`, `MemoryId`, `MemoryType` (the 9 types), `Durability`, `Json` |
| `record.ts` | `MemoryRecord` (confidence + provenance + version), `LoadedMemory`, `Provenance` |
| `query.ts` | `MemoryQuery`, `RetrievalResult`, `RankedRecord`, `WriteResult`, `SearchMode` |
| `engine.ts` | `MemoryEngine` — the single facade with the 8 core ops (save/retrieve/search/update/delete/archive/compress/expire) |
| `versioning.ts` | `VersionedRecord`, `VersionHistory`, `VersionStore` (req #24) |

`MemoryEngine` in `engine.ts` is the only interface agents touch. Everything else (stores, retrieval, intelligence, lifecycle) sits behind it.
