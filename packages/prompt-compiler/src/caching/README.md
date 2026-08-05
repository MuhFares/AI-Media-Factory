# Caching

> Contracts only — declarations, no logic.

Caches assembled `FinalPrompt` to avoid re-compilation.

| Key Component | Description |
|---|---|
| `CacheKey` | `agent + templateVersion + contextHash + schemaHash` |
| `PromptCache` | `get/set/invalidate/invalidatePrefix/invalidateAgent` |
| `CacheStats` | size, hitRate, missRate, evictionRate |

## Invalidation Triggers

| Event | Invalidation |
|---|---|
| Template version bump | `invalidateAgent(agent)` |
| Schema change | `invalidatePrefix(agent + ":" + schemaHash)` |
| Memory superseded | `invalidatePrefix(agent + ":" + contextHash)` |
| Safety rules updated | `invalidateAgent(agent)` |

Config: `maxSize`, `ttlSeconds`, `evictionPolicy` (LRU/LFU/TTL).