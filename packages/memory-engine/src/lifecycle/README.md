# Lifecycle

> Contracts only — declarations, no logic. How durable memory ages: compress → archive → expire, always promoting durable residue first.

| File | Req | Defines |
|---|---|---|
| `compression.ts` | #7, #8 | `Compressor`, `Summarizer` — collapse many observations into fewer scored lessons |
| `expiration.ts` | #9 | `ExpirationPolicy`, `RetentionRule` — by type; permanent types never expire |
| `archive.ts` | #6 | `Archiver` — move aged-but-retained memory to cold storage; still replayable |

**Promote before discard:** ephemeral memory is summarized into durable memory before it expires. **Permanent types (Company/Decision/Lessons) never expire** — they are marked/superseded and retained for audit. Mirrors the archival table in the [Memory Architecture](../../../docs/architecture/memory-architecture.md).
