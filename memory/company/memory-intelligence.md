# Memory Intelligence Layer

> Architecture specification for the intelligence layer on top of AI Media Factory's [Memory Architecture](../../docs/architecture/memory-architecture.md). No application code. Where the Memory Architecture defines *where memory lives*, this document defines *how memory becomes intelligent* — how the company retrieves the right knowledge, ranks it, trusts it, resolves conflicts, and gets measurably smarter after every workflow.

## 0. Core principle

Storage is not intelligence. A pile of documents an agent never reads, cannot rank, and cannot trust is dead weight. The intelligence layer turns AMF's stored memory into a **living knowledge system** that every agent queries before acting and every workflow improves. The measure of success is simple and continuous: **the ten-thousandth workflow is better than the first, because it stands on everything the previous 9,999 learned.** This is the [Compounding Knowledge](../../memory/company/values.md) value made into a system.

```
     ┌──────────────────────────────────────────────────────────────┐
     │                  MEMORY INTELLIGENCE LAYER                    │
     │  Knowledge Graph · Vector Search · Ranking · Confidence ·     │
     │  Conflict Resolution · Compression · Expiration · Learning    │
     └──────────────────────────────┬───────────────────────────────┘
                                     │ sits on top of
     ┌──────────────────────────────▼───────────────────────────────┐
     │  MEMORY ARCHITECTURE (9 types: Company, Agent, Session,       │
     │  Long/Short-term, Decision, Analytics, Knowledge, Lessons)    │
     └────────────────────────────────────────────────────────────────┘
```

---

## 1. The intelligence stack

Every capability requested maps to one of four planes. Read top-down: memory is organized, then retrieved, then trusted, then improved.

| Plane | Capabilities |
|---|---|
| **Organize** | Knowledge Graph · Decision Memory · Agent Experience · Brand Memory · Content Memory · Trend Memory · Performance Memory |
| **Retrieve** | Semantic Search · Vector Search · Memory Ranking · Memory Retrieval Strategy |
| **Trust** | Confidence Score · Source Attribution · Memory Conflict Resolution · Memory Update Rules |
| **Improve** | Lessons Learned Engine · Memory Compression · Memory Expiration · Learning Loops |

---

## 2. ORGANIZE — the knowledge structures

### 2.1 Knowledge Graph

The knowledge graph is the connective tissue of company memory. It represents entities and the relationships between them so retrieval can reason, not just match text.

**Node types:**

| Node | Examples |
|---|---|
| Brand | brd-ai-tools, brd-finance-explainers |
| Asset | ast-000123 (a video, post, article) |
| Topic / Niche | "AI coding tools", "index investing" |
| Decision | dec-880 (kill a brand, enter a niche) |
| Lesson | les-041 ("hooks under 5s lift retention 12%") |
| Agent | writer, seo, growth |
| Experiment | exp-233 (thumbnail A/B) |
| Metric | AGP/Day, CTR, retention |
| Platform | youtube, tiktok |

**Edge types (relationships):**

```
 Brand ──produces──► Asset ──covers──► Topic
   │                   │                 │
   │                   ├─performed──► Metric
   │                   └─governed_by──► Decision
 Lesson ──derived_from──► Asset/Experiment ──applies_to──► Topic/Brand
 Agent ──authored──► Asset          Experiment ──tested──► Topic
 Decision ──produced──► Lesson       Topic ──trending_on──► Platform
```

**Why a graph:** when the Research agent considers a topic, the graph answers *"what have we made near this topic, how did it perform, what lessons apply, and what did the CEO decide about it last time?"* — a text index alone cannot traverse those relationships.

### 2.2 The seven memory domains

Each is a typed region of the graph + store, with its own owner and update path (owners per the [Memory Architecture](../../docs/architecture/memory-architecture.md)).

| Domain | What it remembers | Primary source | Owner |
|---|---|---|---|
| **Decision Memory** | Every one-way-door decision, its gates, and its measured result | CEO at decision time | CEO |
| **Agent Experience** | Per-agent history: what each agent tried, what worked, its calibration | Each agent at run end | Each agent |
| **Brand Memory** | Per-brand voice, audience, safe/unsafe patterns, economics | Brand + Analytics | Brand agent |
| **Content Memory** | Every asset: format, hook, structure, and how it performed | Analytics after publish | Analytics |
| **Trend Memory** | Topic/format demand over time, rising and decaying signals | Research + Analytics | Research |
| **Performance Memory** | Metrics history: CTR, retention, RPM, cost, AGP contribution | Analytics | Analytics |
| **Lessons Learned** | Distilled, reusable findings linked to their evidence | Lessons Engine (§5.1) | CEO + all agents |

These domains are not silos — they are linked in the knowledge graph, so a Content Memory node links to the Performance Memory metrics it earned, the Brand Memory it belongs to, and the Lessons it produced.

---

## 3. RETRIEVE — getting the right memory

### 3.1 Vector Search

Every durable memory entry is embedded into a vector store (behind [`packages/database`](../../packages/database/README.md)). Vector search finds memories by **semantic similarity**, not keyword overlap.

```
query text ──► embed ──► nearest-neighbor search ──► top-k candidate memories
```

- Embeddings are versioned; re-embedding on model change is a background job.
- Vectors are runtime, git-ignored, and rebuildable from the tracked source (per Memory Architecture §3.4).

### 3.2 Semantic Search vs. Graph Search (hybrid retrieval)

Intelligence comes from combining both:

```
 Agent question
     │
     ├─ VECTOR search  → semantically similar memories (fuzzy, "what's like this?")
     ├─ GRAPH traversal → related entities (precise, "what connects to this?")
     └─ MERGE → rank (§3.4) → return with confidence + attribution
```

Example: Writer starting a script on "AI coding tools" gets, via vector search, similar past scripts; via graph traversal, the exact Brand Memory voice rules, the top-performing Content Memory hooks for that brand, and any Lessons linked to that topic.

### 3.3 Memory Retrieval Strategy

Retrieval is scoped by the asking agent and the task, so agents get *relevant* memory, not *all* memory.

| Retrieval rule | Detail |
|---|---|
| **Scope by agent** | Each agent's config defines which domains it may read (Writer reads Brand + Content + Lessons; Finance reads Performance + Decision) |
| **Scope by task** | The current `workflow_id`/topic filters the candidate set |
| **Recency + relevance** | Combine semantic similarity with recency and performance (see ranking) |
| **Budget-bounded** | Retrieval returns top-k (k tuned per agent) to control context cost — Finance/§ cost discipline applies to retrieval too |
| **Confidence-gated** | Low-confidence memories are down-weighted or excluded (§4.1) |

### 3.4 Memory Ranking

Candidates from hybrid retrieval are ranked by a composite score:

```
Rank score = w1·Relevance + w2·Recency + w3·Performance + w4·Confidence − w5·Conflict

  Relevance   = semantic similarity to the query
  Recency     = time-decayed freshness (older memories fade unless reinforced)
  Performance = how well the memory's source asset/experiment actually did
  Confidence  = the memory's confidence score (§4.1)
  Conflict    = penalty if the memory conflicts with higher-ranked memory (§4.3)
```

The weights are tunable per agent and are themselves subject to the learning loop — if high-ranked memories keep leading to poor outcomes, the ranking is recalibrated.

---

## 4. TRUST — making memory reliable

### 4.1 Confidence Score

Every memory carries a confidence score (0.0–1.0) so agents know how much to trust it.

| Confidence driven by | Effect |
|---|---|
| **Evidence strength** | A lesson from 1 asset < a lesson from 100 assets |
| **Recency** | Confidence decays over time unless reinforced by new evidence |
| **Corroboration** | Multiple independent sources agreeing raises confidence |
| **Outcome validation** | A lesson that predicted outcomes correctly gains confidence; one that failed loses it |

Confidence gates behavior: high-confidence memory can be acted on autonomously; low-confidence memory triggers "verify or run a small experiment first" (the Evidence gate from the [Decision Framework](./decision-framework.md)).

### 4.2 Source Attribution

No memory is anonymous. Every entry records its provenance:

```json
{
  "memory_id": "les-041",
  "claim": "Hooks under 5 seconds lift retention ~12% on brd-ai-tools",
  "confidence": 0.82,
  "sources": [
    { "type": "experiment", "ref": "exp-233", "workflow_id": "w-1042" },
    { "type": "asset", "ref": "ast-000123" }
  ],
  "derived_by": "growth",
  "created_at": "2026-07-30T...",
  "last_reinforced": "2026-08-02T...",
  "supersedes": null
}
```

Attribution makes the whole system auditable (the enterprise governance requirement) and makes conflict resolution possible — you cannot adjudicate two claims without knowing where each came from.

### 4.3 Memory Conflict Resolution

When two memories disagree (e.g. one lesson says long intros work for a brand, a newer one says they don't), the system resolves deterministically:

```
Two memories conflict
   │
   ├─ Different scope? (brand A vs brand B) ──► not a conflict; both valid, scoped
   │
   ├─ Same scope, both high-confidence?
   │     └─ prefer NEWER evidence; mark older as superseded (not deleted)
   │
   ├─ Different confidence?
   │     └─ prefer higher confidence; flag for re-validation
   │
   └─ Genuinely unresolved / high stakes?
         └─ escalate to CEO; run an experiment to break the tie (Evidence gate)
```

Resolution is recorded: the losing memory is marked `superseded_by`, preserving history. Conflicts are never resolved by silently overwriting.

### 4.4 Memory Update Rules

| Rule | Detail |
|---|---|
| **Append, don't overwrite** | New knowledge is a new entry; corrections supersede via `supersedes` link |
| **Single writer per domain** | Only the owning agent writes its domain (Memory Architecture §4) |
| **Provenance mandatory** | No entry without sources and `derived_by` |
| **Validated promotion** | Raw observation → candidate → validated memory only after the Evidence gate |
| **Reinforcement updates confidence** | Re-observing a pattern updates `last_reinforced` and raises confidence, without creating a duplicate |
| **Curated canonicalization** | Company/Knowledge/Decision memory changes are reviewed (committed); runtime memory updates automatically (bounded) |

---

## 5. IMPROVE — getting smarter every cycle

### 5.1 Lessons Learned Engine

The engine is the heart of the flywheel: it converts raw outcomes into reusable, confidence-scored lessons.

```
 Workflow completes / Experiment concludes / Decision result known
        │
        ▼
 1. OBSERVE   Analytics attributes the outcome (what happened, by how much)
        │
        ▼
 2. EXTRACT   candidate lesson formed: claim + evidence + scope
        │
        ▼
 3. VALIDATE  Evidence gate: enough signal? statistically meaningful?
        │  ├─ no → hold as low-confidence hypothesis (needs more data)
        │  └─ yes
        ▼
 4. LINK      attach to knowledge graph (topic, brand, agents, metrics)
        │
        ▼
 5. SCORE     assign confidence + attribution
        │
        ▼
 6. PROMOTE   write to knowledge/lessons; if operational, promote to playbooks/
        │
        ▼
 7. FEEDBACK  update ranking weights + agent experience so the next run uses it
```

A lesson is only "learned" when step 7 closes — when it changes what an agent will do next time. A lesson nobody retrieves is not learned.

### 5.2 Memory Compression

Memory cannot grow unbounded. Compression preserves signal and discards noise.

| Technique | What it does |
|---|---|
| **Summarization** | Many similar low-level observations → one higher-level lesson (100 "this hook worked" events → 1 confidence-scored lesson) |
| **Aggregation** | Raw per-asset metrics → rolling brand/topic aggregates (raw expires, aggregate persists) |
| **Deduplication** | Reinforce an existing memory's confidence instead of storing a near-duplicate |
| **Session distillation** | A completed workflow's session memory is distilled to its durable takeaways, then the raw session expires (Memory Architecture §3.3) |

Compression is lossy by design at the raw level and lossless at the lesson level — we keep what we learned, not every keystroke that taught it.

### 5.3 Memory Expiration

Not all memory deserves to live forever. Expiration is by type, and it is a controlled fade, not a delete-and-forget.

| Memory class | Expiration behavior |
|---|---|
| Company / Decision / Lessons | Never expire; superseded entries marked, kept for audit |
| Knowledge Base | Curated; stale entries flagged, refreshed or retired |
| Long-term (validated) | Confidence decays over time; low-confidence stale entries down-weighted, archivable |
| Trend Memory | Fast decay — trends are time-sensitive; old trend signals lose confidence quickly |
| Performance (raw) | 90-day hot window, then compacted to aggregates |
| Session / Short-term | Expire after run (distilled first) |

**Expiration ≠ deletion for committed memory.** A superseded lesson is retained and linked so the reasoning trail survives; only runtime memory is truly purged, and only after its durable residue is promoted.

### 5.4 Learning Loops

Three nested loops make the company continuously smarter. They differ by cadence and scope.

```
 LOOP 1 — Per-workflow (fast, minutes/hours)
   run → Analytics measures → Lessons Engine extracts → memory updated
   → NEXT workflow retrieves the new lesson
        │
        ▼
 LOOP 2 — Per-sprint/cycle (medium, weekly)
   CEO review → patterns across many workflows → strategy + ranking recalibrated
   → Company Memory and playbooks updated
        │
        ▼
 LOOP 3 — Per-phase (slow, quarterly)
   portfolio-level learning → what makes a brand succeed → the model itself improves
   → Knowledge Base + Company Brain evolve
```

Each loop feeds the one below it. Loop 1 makes the next asset better; Loop 2 makes the next brand better; Loop 3 makes the *company* better. The North Star driver they all move is **cost and time to make a new brand profitable falling with each cohort** — the definition of a learning company in [Vision](./vision.md).

---

## 6. End-to-end example: memory getting smarter in one cycle

```
Workflow w-1042 (brd-ai-tools) publishes ast-000123
   │
   ▼  Analytics: retention 58% (brand avg 46%); hook was 4s
   │
   ▼  Lessons Engine: candidate "short hooks (<5s) lift retention on brd-ai-tools"
   │     evidence: exp-233 + ast-000123 → confidence 0.62 (needs more data)
   │
   ▼  Two more assets confirm → confidence rises to 0.82, last_reinforced updated
   │
   ▼  Knowledge graph: lesson linked to topic "AI tools", brand, writer, growth
   │
   ▼  Ranking: this lesson now surfaces high for future AI-tools scripts
   │
   ▼  NEXT workflow w-1119: Writer retrieves it BEFORE drafting → opens with a 4s hook
   │
   ▼  Result: higher retention on the very next asset — the company got smarter
```

Contrast with a conflict:

```
Later, brd-finance-explainers shows long intros outperform.
   │
   ▼  Conflict check: different SCOPE (different brand) → NOT a conflict
   │     both lessons kept, each scoped to its brand
   │
   ▼  If it were the SAME brand with newer contradicting evidence:
         → prefer newer, mark older superseded_by, flag for experiment
```

---

## 7. How the intelligence layer connects

- **Reads/writes** the nine memory types in the [Memory Architecture](../../docs/architecture/memory-architecture.md) — this layer is the intelligence *over* that storage.
- **Feeds** every agent's retrieval step before it acts ([packages/agents](../../packages/agents/README.md)) and the CEO's [North Star evaluation](./ceo-decision-engine.md).
- **Closes the loop** the [Orchestrator Brain](./orchestrator-brain.md) opens: every workflow it runs produces the outcomes this layer turns into lessons.
- **Powers** the data-flywheel moat in [Competitive Advantages](./competitive-advantages.md) and the [Knowledge Base](../../knowledge/README.md) + [Lessons](../../knowledge/lessons/README.md).
- **Obeys** the Evidence gate and confidence discipline of the [Decision Framework](./decision-framework.md).

## 8. The one guarantee

Every completed workflow must leave the company measurably smarter than it found it: at least one memory reinforced, one lesson advanced, or one confidence score updated. A workflow that produces an asset but no learning has only done half its job. That guarantee — learning as a required output of every run — is what turns storage into intelligence and makes AMF compound.

## Related documents

- [Memory Architecture](../../docs/architecture/memory-architecture.md) — the storage layer beneath this intelligence
- [Company Brain](./company.md) · [Values](./values.md) (Compounding Knowledge) · [Vision](./vision.md)
- [Knowledge Base](../../knowledge/README.md) · [Lessons Learned](../../knowledge/lessons/README.md)
- [CEO Decision Engine](./ceo-decision-engine.md) · [Orchestrator Brain](./orchestrator-brain.md)
- [Decision Framework](./decision-framework.md) — the Evidence gate and confidence discipline
