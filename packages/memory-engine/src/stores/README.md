# Stores

> Contracts only — declarations, no logic. One store per memory type; all implement the base `MemoryStore`. The engine facade routes each scoped op to the right store and enforces per-type durability rules.

| Store | Req | Owner | Durability |
|---|---|---|---|
| `session-store.ts` | #17 | Orchestrator | ephemeral (distill → expire ~30d) |
| `company-store.ts` | #18 | CEO (curated) | permanent (supersede only) |
| `agent-store.ts` | #19 | each agent | durable long-term + ephemeral short-term |
| `analytics-store.ts` | #20 | Analytics | rolling (raw ~90d) + archived aggregates |
| `decision-store.ts` | #21 | CEO | permanent, append-only ledger |
| `workflow-store.ts` | #22 | Orchestrator | run-scoped → summarized |
| `lessons-store.ts` | #16 | CEO + agents | permanent (supersede) |
| `checkpoint-store.ts` | #23 | Orchestrator/runtime | until resumed/expired |

`memory-store.ts` is the shared base contract. **Permanent stores refuse `remove()`** and blind overwrite — the engine enforces this so durable truth is never lost (append/supersede only). See [Memory Architecture](../../../docs/architecture/memory-architecture.md) for ownership and lifetimes.
