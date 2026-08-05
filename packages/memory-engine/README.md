# Memory Engine (`@ai-media-factory/memory-engine`)

> Architecture specification for the centralized Memory Engine of AI Media Factory (AMF). **Contracts and architecture only** — the `src/**/*.ts` files are type/interface declarations with no implementation bodies. This package implements the [Memory Architecture](../../docs/architecture/memory-architecture.md) and the [Memory Intelligence Layer](../../memory/company/memory-intelligence.md), and is the single interface every agent uses for memory.

## 0. Core principle

**No agent touches memory files or stores directly. Ever.** Every read and write goes through one facade — the `MemoryEngine`. Agents don't know whether a memory lives in a markdown file, a vector store, a graph, or a cache; they call `save()` / `retrieve()` / `search()` and the engine handles scope, ranking, confidence, attribution, conflict resolution, compression, expiration, and versioning.

```
   13 agents ──save/retrieve/search──►  MEMORY ENGINE (one facade)  ──►  { session · company · agent ·
        never a file path, never a store         │                         analytics · decision · workflow ·
                                                  ▼                         lessons · checkpoints · versions }
                          retrieval pipeline · ranking · confidence · conflict resolution ·
                          compression · expiration · caching · metrics · security boundaries
```

Dependency direction is one-way: **`runtime → memory-engine`** and **`agents → memory-engine`**. This package imports nothing from the runtime; it owns its own memory types so there is one canonical definition and no cycle. The earlier `MemoryStore`/`MemoryRecord` in the runtime now re-export from here.

---

## 1. The 25 requirements → where each lives

| # | Requirement | Home |
|---|---|---|
| 1 | `save()` | `core/engine.ts` (`MemoryEngine`) |
| 2 | `retrieve()` | `core/engine.ts` + `retrieval/pipeline.ts` |
| 3 | `search()` | `retrieval/search.ts` |
| 4 | `update()` | `core/engine.ts` (append/supersede) |
| 5 | `delete()` | `core/engine.ts` (scoped, policy-gated) |
| 6 | `archive()` | `lifecycle/archive.ts` |
| 7 | `compress()` | `lifecycle/compression.ts` |
| 8 | `summarize()` | `lifecycle/compression.ts` |
| 9 | `expire()` | `lifecycle/expiration.ts` |
| 10 | semantic search | `retrieval/search.ts` (`SemanticSearch`) |
| 11 | vector search | `retrieval/vector.ts` (`VectorIndex`) |
| 12 | graph relationships | `retrieval/graph.ts` (`KnowledgeGraph`) |
| 13 | confidence scoring | `intelligence/confidence.ts` |
| 14 | source attribution | `intelligence/attribution.ts` |
| 15 | conflict resolution | `intelligence/conflict.ts` |
| 16 | lessons learned | `stores/lessons-store.ts` + `intelligence/lessons.ts` |
| 17 | session memory | `stores/session-store.ts` |
| 18 | company memory | `stores/company-store.ts` |
| 19 | agent memory | `stores/agent-store.ts` |
| 20 | analytics memory | `stores/analytics-store.ts` |
| 21 | decision memory | `stores/decision-store.ts` |
| 22 | workflow memory | `stores/workflow-store.ts` |
| 23 | checkpoints | `stores/checkpoint-store.ts` |
| 24 | versioning | `core/versioning.ts` |
| 25 | memory metrics | `observability/metrics.ts` |

---

## 2. Folder structure

```
packages/memory-engine/
├── README.md                     # this document
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                  # barrel (types only)
    ├── core/
    │   ├── README.md
    │   ├── engine.ts             # MemoryEngine facade — the 8 core operations
    │   ├── record.ts             # MemoryRecord, MemoryScope, MemoryType, Provenance
    │   ├── query.ts              # MemoryQuery, RetrievalResult, WriteResult
    │   └── versioning.ts         # VersionedRecord, VersionHistory (req #24)
    ├── stores/
    │   ├── README.md
    │   ├── memory-store.ts       # base MemoryStore contract (all types implement it)
    │   ├── session-store.ts      # (#17)  ephemeral, per workflow run
    │   ├── company-store.ts      # (#18)  permanent, curated truth
    │   ├── agent-store.ts        # (#19)  per-agent long/short term
    │   ├── analytics-store.ts    # (#20)  rolling + archived metrics memory
    │   ├── decision-store.ts     # (#21)  permanent decision ledger
    │   ├── workflow-store.ts     # (#22)  per-workflow state/events memory
    │   ├── lessons-store.ts      # (#16)  permanent lessons corpus
    │   └── checkpoint-store.ts   # (#23)  resume checkpoints
    ├── retrieval/
    │   ├── README.md
    │   ├── pipeline.ts           # RetrievalPipeline (the funnel)
    │   ├── search.ts             # SemanticSearch, keyword/hybrid search (#3, #10)
    │   ├── vector.ts             # VectorIndex, Embedding (#11)
    │   ├── graph.ts              # KnowledgeGraph, Node, Edge (#12)
    │   └── ranking.ts            # RankingStrategy, RankSignal
    ├── intelligence/
    │   ├── README.md
    │   ├── confidence.ts         # ConfidenceScorer (#13)
    │   ├── attribution.ts        # AttributionTracker (#14)
    │   ├── conflict.ts           # ConflictResolver (#15)
    │   └── lessons.ts            # LessonsEngine (#16)
    ├── lifecycle/
    │   ├── README.md
    │   ├── compression.ts        # Compressor, Summarizer (#7, #8)
    │   ├── expiration.ts         # ExpirationPolicy (#9)
    │   └── archive.ts            # Archiver (#6)
    ├── caching/
    │   └── README.md             # caching strategy
    ├── observability/
    │   ├── README.md
    │   └── metrics.ts            # MemoryMetrics (#25)
    └── security/
        └── README.md             # access control + security boundaries
```

---

## 3. The facade — one interface for all memory

Every agent uses only [`core/engine.ts`](./src/core/engine.ts). The eight core operations, each **scoped** by memory type so the engine routes to the right store:

```
MemoryEngine
  ├─ save(scope, record)             → WriteResult        # #1  (append/supersede, versioned)
  ├─ retrieve(query)                 → RetrievalResult    # #2  (ranked, confidence-scored)
  ├─ search(query)                   → RetrievalResult    # #3  (semantic + vector + graph)
  ├─ update(id, patch)               → WriteResult        # #4  (supersede, never blind overwrite)
  ├─ delete(scope, id, reason)       → void               # #5  (policy-gated; permanent types refuse)
  ├─ archive(scope, criteria)        → ArchiveReport      # #6
  ├─ compress(scope, criteria)       → CompressionReport  # #7 + summarize #8
  └─ expire(scope, asOf)             → ExpirationReport   # #9
```

`scope` names the memory **type** (session/company/agent/analytics/decision/workflow/lessons/checkpoint). The engine enforces per-type rules — e.g. `delete()` on Decision or Company memory is refused (they are append-only, audit-grade); `expire()` only affects ephemeral/rolling types.

---

## 4. Memory hierarchy

The engine maps every request to one of the memory types from the [Memory Architecture](../../docs/architecture/memory-architecture.md), preserving each type's ownership and lifetime.

| Type | Scope | Lifetime | Writable via engine by | Deletable? |
|---|---|---|---|---|
| Session (#17) | one workflow run | ephemeral | Orchestrator | expires |
| Company (#18) | whole company | permanent | CEO (curated) | no (supersede only) |
| Agent (#19) | one agent | durable + ephemeral | that agent | short-term clears |
| Analytics (#20) | whole company | rolling + archived | Analytics | raw expires |
| Decision (#21) | whole company | permanent | CEO | no (append-only) |
| Workflow (#22) | one workflow | run-scoped + summarized | Orchestrator | summarize→expire |
| Lessons (#16) | whole company | permanent | CEO + agents | no (supersede) |
| Checkpoints (#23) | one turn/workflow | until resumed/expired | Orchestrator/runtime | expires |

**Single-writer rule** (from the Memory Architecture): the engine enforces that an agent may write only the memory it owns; cross-agent knowledge flows as events, never as a direct write into another agent's memory.

---

## 5. Memory lifecycle

Every durable memory moves through the same lifecycle, orchestrated by the engine:

```
 CREATE ──► VALIDATE ──► SCORE (confidence #13, attribution #14)
    │                         │
    │                         ▼
    │                   CONFLICT CHECK (#15) ──conflict──► resolve (supersede / scope / escalate)
    │                         │
    ▼                         ▼
 STORE (versioned #24) ──► INDEX (vector #11 + graph #12) ──► SERVE (retrieve/search #2/#3)
    │
    ▼  as it ages:
 REINFORCE (confidence↑) ──► COMPRESS/SUMMARIZE (#7/#8) ──► ARCHIVE (#6) ──► EXPIRE (#9)
```

- **Promote before discard:** ephemeral memory (session/short-term) is summarized into durable memory (lessons/analytics) *before* it expires — nothing valuable is lost.
- **Append over overwrite:** `update()` supersedes with a version link; history is retained (#24).
- **Learning is a required output:** per the Memory Intelligence guarantee, a completed workflow must leave at least one memory reinforced, one lesson advanced, or one confidence score updated.

---

## 6. Retrieval pipeline

`retrieve()` and `search()` run the same funnel ([`retrieval/pipeline.ts`](./src/retrieval/pipeline.ts)):

```
 query (agent, task, scope, text)
   │
   ▼ (1) SCOPE FILTER     which memory types may this agent read? (security #, single-writer)
   ▼ (2) CANDIDATE FETCH  hybrid:
   │        • VECTOR search (#11)  — semantic nearest-neighbours
   │        • GRAPH traversal (#12) — related entities (brand/topic/agent/decision/lesson)
   │        • KEYWORD/exact         — precise lookups
   ▼ (3) MERGE + DEDUPE   union candidates, dedupe by memory_id
   ▼ (4) CONFLICT CHECK   (#15) drop/mark superseded, flag contradictions
   ▼ (5) RANK             composite score (below)
   ▼ (6) CONFIDENCE GATE  (#13) drop/deprioritize low-confidence
   ▼ (7) BUDGET CAP       top-k tuned per agent (context-cost bounded)
   │
   ▼ RetrievalResult { records[], each with confidence + provenance (#14) }
```

The caller (an agent, via the runtime) gets a small, ranked, trustworthy set — never a raw dump.

### 6.1 Ranking algorithm

```
Rank = w1·Relevance + w2·Recency + w3·Performance + w4·Confidence − w5·Conflict

  Relevance   = semantic similarity (vector) + graph proximity
  Recency     = time-decayed freshness (trend memory decays fast; company memory doesn't)
  Performance = how well the source asset/experiment actually performed
  Confidence  = the record's confidence score (#13)
  Conflict    = penalty when it contradicts a higher-ranked record (#15)
```

Weights are tunable per memory type and per agent, and are themselves subject to the learning loop — if high-ranked memories keep leading to poor outcomes, ranking is recalibrated (Memory Intelligence).

---

## 7. Intelligence layer (confidence, attribution, conflict, lessons)

| Concern | Contract | Rule |
|---|---|---|
| **Confidence (#13)** | `ConfidenceScorer` | 0..1, driven by evidence strength, corroboration, recency decay, and outcome validation. Gates whether memory is acted on autonomously vs. "verify first". |
| **Attribution (#14)** | `AttributionTracker` | Every record carries `sources[]` + `derived_by`. No anonymous memory. Makes the corpus auditable. |
| **Conflict (#15)** | `ConflictResolver` | Different scope → both valid (scoped). Same scope → prefer newer/higher-confidence, mark loser `superseded_by`; high-stakes ties escalate to CEO + trigger an experiment. Never silent overwrite. |
| **Lessons (#16)** | `LessonsEngine` | observe → extract → validate (Evidence gate) → link (graph) → score → promote to lessons store → feed back into ranking. |

---

## 8. Compression, summarization, expiration, archival

- **Compress/summarize (#7/#8)** — many low-level observations collapse into one higher-level, confidence-scored lesson; raw per-item detail is summarized before it expires. Lossy at the raw level, lossless at the lesson level.
- **Expire (#9)** — by type: Session ~30 days (after distillation), raw Analytics ~90-day hot window then compaction, Trend memory fast decay, Short-term at turn end. **Permanent types (Company/Decision/Lessons) never expire** — they are marked/superseded, retained for audit.
- **Archive (#6)** — cold storage for aged-but-retained data ([`data/`](../../data/README.md)); still replayable/queryable, just not hot.

Full policy in [`lifecycle/README.md`](./src/lifecycle/README.md); mirrors the archival table in the [Memory Architecture](../../docs/architecture/memory-architecture.md).

---

## 9. Caching strategy

The engine caches to keep retrieval cheap without serving stale truth:

| Cache | Holds | Invalidated when |
|---|---|---|
| Embedding cache | query/text → vector | text or embedding model changes |
| Retrieval cache | (agent, query) → ranked ids | underlying records updated/superseded/expired |
| Hot-memory cache | frequently-read company/lessons records | the source record is superseded |

Rules: caches are keyed by content + version, so a superseded/expired record is never served from cache; ephemeral memory is not cross-turn cached. See [`caching/README.md`](./src/caching/README.md).

---

## 10. Observability & metrics (#25)

`MemoryMetrics` ([`observability/metrics.ts`](./src/observability/metrics.ts)) records: retrieval latency (p50/p95), hit/miss rates, records-per-query, confidence distribution, conflict rate, compression ratio, expiration/archival volumes, cache hit rate, and the learning-loop signal (memories reinforced/lessons advanced per workflow). Shipped to [infra/monitoring](../../infra/monitoring/README.md) and consumed by the [Analytics Brain](../../memory/company/analytics-brain.md).

---

## 11. Security boundaries

- **No direct file/store access by agents** — the facade is the only door. This is the whole point of the engine.
- **Scoped access** — the engine enforces which memory types each agent may read/write, from the agent's config. The single-writer rule is enforced here.
- **Permanent-type protection** — Company/Decision/Lessons memory cannot be deleted or blind-overwritten via the engine; only append/supersede.
- **Provenance required** — writes without `sources`/`derived_by` are rejected.
- **Secret hygiene** — memory bodies are validated; secrets are never stored in memory records or logs. Credentials for backing stores come from the environment ([`configs/environments`](../../configs/environments/README.md)).
- **Audit trail** — every write, supersede, delete-attempt, and conflict resolution is logged with correlation ids.

See [`security/README.md`](./src/security/README.md).

---

## 12. Relationship to the runtime and agents

- The **runtime** binds to this engine: its `MemoryLoader.loadForTurn()` calls `retrieve()`, and its `SAVING` state calls `save()`. The runtime's old `MemoryStore`/`MemoryRecord` types now re-export from here (single source of truth).
- **Agents** never import a store; they receive `LoadedMemory` in their `ExecutionContext` and their durable takeaways are persisted by the runtime through the engine.
- **Backing stores** (vector DB, graph, relational, object storage) live behind [`packages/database`](../database/README.md); the engine depends on their abstractions, not their implementations — swappable.

## 13. Boundaries — what the engine never does

- **Never lets an agent bypass it.** No direct file or store access anywhere.
- **Never makes business decisions.** It stores/retrieves knowledge; the CEO/agents decide.
- **Never silently overwrites or deletes durable truth.** Append/supersede, versioned, audited.
- **Never serves stale or superseded memory from cache.**
- **Never stores secrets** in memory records.

## Status

Contracts and architecture only. No implementation. This is the specification a memory-engine implementation will satisfy.

## Related documents

- [Memory Architecture](../../docs/architecture/memory-architecture.md) — the 9 memory types this engine implements
- [Memory Intelligence Layer](../../memory/company/memory-intelligence.md) — the ranking/confidence/lessons design this engine executes
- [Runtime](../runtime/README.md) — binds to this engine for load/save
- [packages/database](../database/README.md) — the backing stores (vector/graph/relational/object)
- [Analytics Brain](../../memory/company/analytics-brain.md) — consumes memory metrics
