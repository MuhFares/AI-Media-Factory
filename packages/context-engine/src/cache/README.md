# Cache

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `cache.ts` | `ContextCache`, `CacheKey`, `CacheStats` | #13 |

## Cache Key

```
agent + workflowId + stepId + trigger + contextHash + budgetHash
```

## Invalidation Triggers

| Event | Invalidation |
|---|---|
| Memory superseded/updated | Invalidate affected agent/workflow |
| New lesson promoted | Invalidate relevant agents |
| Workflow context changed | Invalidate workflow |
| Budget params changed | Invalidate all |
| Template/schema change | Invalidate all |

Config: `maxSize`, `ttlSeconds`, `evictionPolicy` (LRU/LFU/TTL).