# Memory Architecture

> Knowledge-architecture specification for AI Media Factory (AMF). Documentation only — no code. This design maps the nine memory types onto the repository's existing structure and defines ownership, lifecycle, update rules, and archival rules for each.

## Purpose

An autonomous company that cannot remember is condemned to repeat itself. AMF's advantage is the [Compounding Knowledge](../../memory/company/values.md) flywheel, and that flywheel only turns if memory is deliberately architected: the right information, held at the right scope, for the right lifetime, owned by the right agent.

This document separates memory into nine distinct types, each with a clear scope, a single owner, and explicit rules. The governing principle is **scope + lifetime**: every piece of state belongs to exactly one memory type, chosen by how widely it is shared and how long it must live.

---

## 1. The nine memory types at a glance

| Memory type | Scope | Lifetime | Location | Owner | Tracked in git? |
|---|---|---|---|---|---|
| **Company Memory** | Whole company | Permanent | [`memory/company/`](../../memory/company/README.md) | CEO | Yes (source of truth) |
| **Agent Memory** | One agent | Durable | [`memory/agents/`](../../memory/agents/README.md) + each agent's `memory/` | Each agent | Runtime = ignored; contracts = tracked |
| **Session Memory** | One workflow run | Ephemeral | `memory/sessions/` | Orchestrator | Runtime = ignored |
| **Long-term Memory** | Cross-run (per agent/company) | Durable, vector-backed | agent `memory/long_term.md` + stores | Each agent / CEO | Contracts tracked; vectors ignored |
| **Short-term Memory** | Single run | Ephemeral | agent `memory/short_term.md` + session | Each agent | Contracts tracked; state ignored |
| **Decision Memory** | Whole company | Permanent | `memory/decisions/` + [`docs/decisions/`](../../docs/decisions/README.md) | CEO | Yes |
| **Analytics Memory** | Whole company | Rolling + archived | [`memory/analytics/`](../../memory/analytics/README.md) + [`data/analytics/`](../../data/analytics/README.md) | Analytics | Aggregates tracked; raw ignored |
| **Knowledge Base** | Whole company | Curated, permanent | [`knowledge/`](../../knowledge/README.md) | Analytics + Research (curated by CEO) | Yes |
| **Lessons Learned** | Whole company | Permanent | [`knowledge/lessons/`](../../knowledge/lessons/README.md) | CEO + all agents | Yes |

Two axes explain every placement:
- **Tracked (committed) vs. runtime (git-ignored).** Contracts, curated knowledge, and decisions are *committed* — they are the company's deliberate, reviewable memory. Runtime state (session scratch, vector snapshots, raw metrics, logs) is *git-ignored* and lives only at runtime.
- **Durable vs. ephemeral.** Ephemeral memory is cleared when its scope ends (a run, a session). Durable memory persists and compounds.

---

## 2. The memory map (how the types relate)

```
                          COMPANY MEMORY  (memory/company/  — permanent truth)
                                   │ every agent reads before acting
                                   ▼
   DECISION MEMORY ◄──────── CEO / Executive Brain ──────────► KNOWLEDGE BASE
   (memory/decisions/,                 │                        (knowledge/)
    docs/decisions/)                   │                              ▲
        ▲                              ▼                              │ curated from
        │ records            AGENT MEMORY (per agent)                 │
        │ one-way doors        ├── LONG-TERM  (long_term.md + vectors)│
        │                      └── SHORT-TERM (short_term.md)         │
        │                              │                              │
        │                              ▼                              │
        │                     SESSION MEMORY (memory/sessions/)       │
        │                      one workflow run, ephemeral            │
        │                              │                              │
        └────────── ANALYTICS MEMORY ──┴──► LESSONS LEARNED ──────────┘
             (memory/analytics/, data/analytics/)   (knowledge/lessons/)
             measures every run                     what we learned, feeds the flywheel
```

The loop: Company Memory frames every decision → agents act using Agent/Session memory → Analytics measures the results → Lessons are extracted → the Knowledge Base and Company Memory are updated → the next run starts smarter. This is the [Self-Learning Flywheel](../../memory/company/competitive-advantages.md) rendered as a memory system.

---

## 3. The nine types in detail

### 3.1 Company Memory
- **What:** The permanent business truth — mission, vision, values, business model, KPIs, brand guidelines, glossary. The [Company Brain](../../memory/company/README.md).
- **Scope / Lifetime:** Whole company / permanent.
- **Owner:** CEO / Executive Brain. Every agent is a reader; only the CEO (with human approval) is a writer.
- **Lifecycle:** Authored once, then amended deliberately. Read at the start of every agent run.
- **Update rules:** Changed only through a reviewed edit; strategic changes are recorded as Decision Memory. Never edited mid-run by a specialist agent.
- **Archival rules:** Never deleted. Superseded content is marked superseded, not removed; git history is the archive.

### 3.2 Agent Memory
- **What:** Everything one agent needs to remember — its long-term knowledge and its short-term working state. Contracts live in each agent's `memory/` folder ([e.g. ceo/memory](../../packages/agents/ceo/README.md)); consolidated durable stores live in [`memory/agents/`](../../memory/agents/README.md).
- **Scope / Lifetime:** One agent / durable (long-term) + ephemeral (short-term).
- **Owner:** The agent itself.
- **Lifecycle:** Loaded at run start, written during the run, durable portion persisted at run end.
- **Update rules:** An agent writes only its own memory. It never writes another agent's memory — cross-agent information flows as events, not shared memory.
- **Archival rules:** Durable stores are versioned; short-term is discarded per §3.5.

### 3.3 Session Memory
- **What:** The working state of a single workflow run — the events exchanged, intermediate artifacts, and the run's context, keyed by `workflow_id`.
- **Scope / Lifetime:** One workflow run / ephemeral.
- **Owner:** Orchestrator (it owns run coordination).
- **Location:** `memory/sessions/` (runtime, git-ignored). Resumable state is checkpointed to [`memory/checkpoints/`](../../memory/checkpoints/README.md).
- **Lifecycle:** Created when a workflow starts, written by every agent in the run (via events), closed when the run completes or dead-letters.
- **Update rules:** Append-only during the run; keyed by `workflow_id` and `event_id` so the run is fully traceable.
- **Archival rules:** Summarized on completion — durable outcomes promoted to Analytics/Lessons memory, then the raw session is expired (default 30 days) and purged. Dead-lettered sessions are retained longer for diagnosis.

### 3.4 Long-term Memory
- **What:** Cross-run knowledge that must persist and compound — per agent (e.g. Brand's ruling ledger, CEO's decision ledger) and company-wide. Contract in each agent's `memory/long_term.md`; vectors in the store behind [`packages/database`](../../packages/database/README.md).
- **Scope / Lifetime:** Cross-run / durable.
- **Owner:** Each agent for its own long-term memory; CEO for company long-term memory.
- **Lifecycle:** Written at run end with the run's durable takeaways; read at the start of future runs via retrieval (RAG).
- **Update rules:** Append and refine; entries carry provenance (which run, which evidence). Corrections supersede, they do not silently overwrite.
- **Archival rules:** Vector snapshots are runtime-generated and git-ignored; the markdown contracts are tracked. Nothing is hard-deleted; stale entries are down-weighted or marked superseded.

### 3.5 Short-term Memory
- **What:** Scratch space for a single run — the current input, intermediate reasoning, the draft output before emission. Contract in each agent's `memory/short_term.md`.
- **Scope / Lifetime:** Single run / ephemeral.
- **Owner:** The agent, for the duration of its run.
- **Lifecycle:** Populated at run start, used through the agent's instructions, cleared when the output event is emitted.
- **Update rules:** Freely mutable within the run; never authoritative. Anything worth keeping is promoted to Long-term Memory before the run closes.
- **Archival rules:** Not archived. Discarded at run end (its durable residue lives on in Long-term/Session memory).

### 3.6 Decision Memory
- **What:** The permanent record of material decisions — one-way-door choices (brand launch/kill, niche entry, hiring an agent, pricing) and the architecture/technical decisions in [`docs/decisions/`](../../docs/decisions/README.md) (ADRs).
- **Scope / Lifetime:** Whole company / permanent.
- **Owner:** CEO for business decisions; the proposing architect/agent for ADRs — all curated centrally.
- **Location:** `memory/decisions/` (operational/business decision records) and [`docs/decisions/`](../../docs/decisions/README.md) (ADRs). Both tracked in git.
- **Lifecycle:** A decision is recorded at the moment it is made, using the template in the [Decision Framework](../../memory/company/decision-framework.md), with its `Result` filled in later once the outcome is known.
- **Update rules:** Append-only. A decision record is never edited to change history; it is superseded by a new record that references it. Filling in the `Result` field is mandatory — that is what turns a decision into a lesson.
- **Archival rules:** Never deleted. Superseded decisions are marked and linked to their successor, preserving a complete audit trail (a governance requirement for enterprise buyers).

### 3.7 Analytics Memory
- **What:** What the company has measured — rolling performance metrics, learned performance patterns, and the raw event data behind them.
- **Scope / Lifetime:** Whole company / rolling (hot) + archived (cold).
- **Owner:** Analytics agent.
- **Location:** [`memory/analytics/`](../../memory/analytics/README.md) (persisted analytical memory, patterns, aggregates — tracked selectively) and [`data/analytics/`](../../data/analytics/README.md) (raw event data — runtime, git-ignored).
- **Lifecycle:** Written after each `PublishingFinished` as metrics are attributed; aggregated on a rolling window; feeds the CEO weekly review.
- **Update rules:** Raw data is append-only; aggregates are recomputed on schedule. Attribution methods are versioned so historical numbers remain interpretable.
- **Archival rules:** Hot window (default 90 days) kept queryable; older raw data compacted into aggregates and moved to cold storage / [`data/datasets/`](../../data/datasets/README.md). Aggregated insights persist; raw granular data is subject to retention limits.

### 3.8 Knowledge Base
- **What:** The curated, retrievable corpus that powers agent RAG — playbooks-adjacent knowledge across [business, competitors, content, YouTube, TikTok, Instagram, SEO, analytics, prompts](../../knowledge/README.md).
- **Scope / Lifetime:** Whole company / curated, permanent.
- **Owner:** Analytics and Research produce candidate knowledge; the CEO curates what becomes canonical.
- **Lifecycle:** Populated from validated lessons and research; embedded into the vector store; retrieved by production agents before they act.
- **Update rules:** Curated, not dumped. Knowledge is promoted here only when validated (Evidence gate); entries are dated and sourced. Distinct from `data/` — this is *curated wisdom*, not raw data.
- **Archival rules:** Tracked in git and versioned. Outdated knowledge is marked stale and either refreshed or retired, never silently trusted.

### 3.9 Lessons Learned
- **What:** Post-mortems, retrospectives, and "what we learned" that feed continuous improvement — the explicit output of the flywheel's *learn* step.
- **Scope / Lifetime:** Whole company / permanent.
- **Owner:** CEO owns the ritual; every agent contributes lessons from its own domain.
- **Location:** [`knowledge/lessons/`](../../knowledge/lessons/README.md).
- **Lifecycle:** A lesson is written when a decision's `Result` is known, an experiment concludes, or an incident is resolved. It is then read by relevant agents before similar work.
- **Update rules:** Append-only, dated, and attributed to the run/decision that produced it. A lesson links back to its Decision Memory and Analytics Memory evidence.
- **Archival rules:** Never deleted. A superseded lesson is updated with a newer finding and cross-linked, so the reasoning trail is intact.

---

## 4. Ownership summary (single-writer principle)

Every memory type has exactly one owning writer, even when many agents read it. This prevents the accountability gap described in [Values](../../memory/company/values.md).

| Owner | Writes | Reads (examples) |
|---|---|---|
| CEO | Company Memory, Decision Memory, curates Knowledge Base + Lessons | everything |
| Orchestrator | Session Memory, Checkpoints | agent contracts |
| Each agent | Its own Agent/Long-term/Short-term memory | Company Memory, Knowledge Base, its own long-term |
| Analytics | Analytics Memory; proposes Knowledge + Lessons | Session outcomes, platform data |
| Research | Proposes Knowledge Base entries | Knowledge Base, Company Memory |

**Rule:** an agent may read any memory its config allows, but writes only what it owns. Cross-agent information moves as **events** (see the [Agent Contract System](./agent-contract-system.md)), never by writing into another agent's memory.

---

## 5. Lifecycle rules (global)

1. **Read Company Memory first.** Every agent run begins by loading the relevant Company Brain documents. No agent acts without the shared context.
2. **Work in Short-term/Session memory.** Runs mutate ephemeral memory freely.
3. **Promote before you discard.** Anything durable (a lesson, a decision result, a metric) is promoted to its permanent home before the ephemeral scope closes.
4. **Measure, then learn.** Analytics writes outcomes; Lessons and Knowledge are updated from validated outcomes only.
5. **Record material decisions immediately.** One-way doors are written to Decision Memory at the moment of decision, not reconstructed later.

---

## 6. Update rules (global)

- **Committed memory changes are deliberate and reviewed** (Company, Decision, Knowledge, Lessons). They go through a reviewed edit and, when strategic, a decision record.
- **Runtime memory changes are automatic and bounded** (Session, Short-term, raw Analytics, vectors). They happen without human review but are governed by retention limits.
- **Append over overwrite.** Ledgers (decisions, lessons, long-term) append and supersede; they do not rewrite history.
- **Provenance is mandatory.** Durable entries record where they came from (run, evidence, decision) so the flywheel is auditable.
- **Schema version gates cross-agent state.** Anything shared between agents carries `schema_version`; a mismatch is rejected, not guessed at.

---

## 7. Archival rules (global)

| Class | Retention | Archive action |
|---|---|---|
| Company / Decision / Lessons | Permanent | Never deleted; superseded entries marked + cross-linked; git history is the archive |
| Knowledge Base | Permanent, curated | Stale entries flagged; refreshed or retired, never silently trusted |
| Long-term (contracts) | Permanent | Versioned in git |
| Long-term (vectors) | Durable, runtime | Snapshotted; rebuildable from source; git-ignored |
| Analytics (aggregates) | Long | Retained; recomputed on method change |
| Analytics (raw) | 90-day hot window | Compacted to aggregates, moved to cold storage / datasets |
| Session Memory | 30 days (longer if dead-lettered) | Summarized to durable memory, then purged |
| Short-term Memory | End of run | Discarded (residue promoted first) |
| Logs | Per [logs](../../logs/README.md) policy | Shipped to monitoring; rotated |

**Deletion vs. archival:** committed memory is *archived* (marked, superseded, retained). Only runtime memory is ever *deleted*, and only after its durable residue has been promoted.

---

## 8. How this connects

- Business truth: [Company Brain](../../memory/company/README.md)
- Decision recording: [Decision Framework](../../memory/company/decision-framework.md), [docs/decisions](../../docs/decisions/README.md)
- Agent memory contracts: [packages/agents](../../packages/agents/README.md) and the [Agent Contract System](./agent-contract-system.md)
- Curated corpus: [knowledge](../../knowledge/README.md); lessons: [knowledge/lessons](../../knowledge/lessons/README.md)
- Runtime state anchors: [memory](../../memory/README.md), [checkpoints](../../memory/checkpoints/README.md), [logs](../../logs/README.md), [data](../../data/README.md)

The memory architecture is what makes AMF a *learning* company rather than one that merely runs. Company Memory keeps it aligned, Decision and Lessons memory keep it honest, and the Analytics-to-Knowledge loop is the flywheel that makes each cycle smarter than the last.
