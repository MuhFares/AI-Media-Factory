# Event-Driven Architecture — AI Media Factory

> Architecture specification. No application code. This document defines the complete event-driven backbone of AI Media Factory (AMF): how agents communicate, how events live and die, and how the system stays reliable, traceable, and recoverable.

## 0. Core principle

**Agents communicate ONLY through events.** There are no direct agent-to-agent calls. The CEO never calls the Writer; the Writer never calls the Publisher. Every hand-off, every signal, every failure is an event published to the Event Bus and consumed by whichever agent has subscribed. This is what lets the workforce scale horizontally, survive failures, and remain independently testable — it is moat #3 in the [Competitive Advantages](../../memory/company/competitive-advantages.md).

```
┌──────────────────────────────────────────────────────────────────────┐
│                        EVENT BUS (log + stream)                       │
│   publish ┌──────────────┐  publish ┌──────────────┐  publish ...      │
│  ┌───────►│  Agent A      │────────►│  Agent B      │───────► ...      │
│  │        └──────────────┘         └──────────────┘                   │
│  │                ▲                                                     │
│  └────────────────┘   never direct calls — always events                │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 1. Event Bus

### 1.1 Responsibilities

The Event Bus is the single messaging backbone. It must provide:

- **Publish** — append an event to a topic/stream.
- **Subscribe** — deliver events to agents that have expressed interest (topic-based, plus routing by `target_agent`).
- **Ordering** — per-partition ordering (per `workflow_id` / `correlation_id`) so a run's events replay in order.
- **Retention** — the bus IS the Event Store (log), so events can be replayed.
- **Backpressure** — slow consumers must not be allowed to silently drop or stall the bus.
- **Dead-lettering** — events that cannot be processed move to the Dead Letter Queue (DLQ) with full context.

### 1.2 Logical topology

```
                 ┌─────────────────────────────┐
   Agent A ─────►│  EVENT BUS (partitioned log) │◄───── Agent E
   Agent B ─────►│  - topics                   │──────► Agent F
   Agent C ─────►│  - per-workflow partitions  │
                 └────────────┬────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
       ┌──────────┐   ┌──────────┐   ┌──────────────┐
       │ Event     │   │ Dead     │   │ Event Store  │
       │ Subsystem │   │ Letter   │   │ (replayable) │
       └──────────┘   │ Queue    │   └──────────────┘
                      └──────────┘
```

### 1.3 Consistency model

- **At-least-once delivery** to consumers (paired with idempotency, §12).
- **Append-only log** semantics for the store. Events are never mutated after publish.
- Ordering is guaranteed **per partition** (key = `workflow_id`), not globally.

---

## 2. Message Format

Every event on the bus conforms to the shared envelope (draft-07 JSON Schema) already defined in the [Agent Contract System](./agent-contract-system.md). A full example:

```json
{
  "schema_version": "1.0.0",
  "event_id": "8f14e45f-ea9b-4b9b-9b1f-4c8e9e7f1a2b",
  "workflow_id": "7c3e1d0a-1234-4a56-9abc-def012345678",
  "correlation_id": "campaign-2026-w17-tech-briefs",
  "brand_id": "brd-finance-explainers",
  "asset_id": "ast-000123",
  "timestamp": "2026-08-02T14:53:50.000Z",
  "type": "ResearchCompleted",
  "source_agent": "research",
  "target_agent": "writer",
  "payload": { "...": "agent-specific" },
  "metadata": {
    "cost_usd": 0.041,
    "model": "reasoning-tier-medium",
    "latency_ms": 842
  }
}
```

Rules:
- `schema_version` is const `1.0.0`; a mismatch rejects the event.
- `event_id` is unique per event (idempotency key, §12).
- `workflow_id` keys the partition and the [State Machine](#9).
- `correlation_id` ties cross-workflow activity (a campaign, a user request) — §13.
- `metadata` carries cost, model, and latency for [tracing](#14) and Finance.

---

## 3. Event Types

Events are typed by the schema's `type` constant and grouped by layer.

| Layer | Event types (canonical) |
|---|---|
| **Executive** | `ExecutiveDirective`, `CEOReviewRequested` |
| **Execution** | `TaskDispatched` |
| **Production** | `ResearchFinished` → `ScriptFinished` → `SEOFinished` → `ThumbnailFinished` → `VideoFinished` |
| **Gates** | `QAReviewed`, `PublishApproved` |
| **Distribution** | `PublishingFinished` |
| **Feedback** | `AnalyticsReported`, `FinanceReported`, `GrowthProposed` |
| **System / infra** | `WorkflowStarted`, `WorkflowSucceeded`, `WorkflowFailed`, `DeadLettered`, `CheckpointCreated`, `EscalationRequired` (infra events emitted by the bus/Orchestrator, not agents) |

The six example events you requested map to the schema event chain as the canonical past-tense naming of production milestones:

| Requested example | Canonical type | Producer | Consumer |
|---|---|---|---|
| `ResearchCompleted` | `ResearchFinished` | research | writer |
| `ScriptGenerated` | `ScriptFinished` | writer | seo |
| `SEOFinished` | `SEOFinished` | seo | thumbnail |
| `VideoRendered` | `VideoFinished` | video | qa |
| `PublishingCompleted` | `PublishingFinished` | publisher | analytics |
| `AnalyticsUpdated` | `AnalyticsReported` | analytics | finance + growth |

(These are the same events in the committed schemas; the canonical types are the ones in `schemas/*.schema.json`.)

---

## 4. Event Naming Convention

### 4.1 Rule

`<DomainEntity><PastTenseVerb>` — a completed state, written in the past tense, PascalCase.

### 4.2 Conventions

- **Verb is the completion:** `ResearchFinished`, `ScriptFinished`, `VideoFinished`, `PublishingFinished`. Signals *done*, not *starting*.
- **Rejected forms:**
  - Imperative/command names (`GenerateScript`) — commands are reserved for `TaskDispatched` from the Orchestrator.
  - `-ing` progress forms (`RenderingVideo`) — these are telemetry, not domain events.
  - Generic names (`Event`, `Update`, `Message`) — must name the domain entity and outcome.
- **Intents vs. facts:** a *request* to do work is `TaskDispatched` (only from Orchestrator); everything else is a *fact* that something completed.

---

## 5. Event Lifecycle

The lifecycle of an event from publication to archival:

```
 publish → validate → store → deliver → process → ack
                                    │
                                    └── failed → retry (bounded) → DLQ
```

| Stage | Action |
|---|---|
| **Publish** | Producer emits the event to the bus with its `event_id`. |
| **Validate** | Bus validates against the consumer's `input.schema.json`. Invalid → immediate DLQ (dead-letter), never processed. |
| **Store** | Event appended to the Event Store (log). This is the record of truth. |
| **Deliver** | Bus routes to subscribers (by topic + `target_agent`). At-least-once. |
| **Process** | Consumer runs its step. |
| **Ack** | Consumer acks after **successful processing** (not receipt). Unacked → retry. |
| **Retry / DLQ** | Bounded retry, then dead-letter (§6–7). |
| **Archive** | Retention policy (§10); replayable until then. |

---

## 6. Retry Strategy

### 6.1 Policy (default)

| Parameter | Value |
|---|---|
| Max attempts | 3 |
| Backoff | Exponential: 1s, 4s, 16s (jittered) |
| Ordering during retry | Per `workflow_id` partition; a retried event blocks later events in its partition |
| On final failure | Move to Dead Letter Queue with full context |

### 6.2 Retry classification

| Failure type | Retryable? | Why |
|---|---|---|
| Transient (timeout, temporary 5xx, rate limit) | Yes | Likely resolves |
| Recoverable-after-conditions (dependency not ready) | Yes, with backoff | Resource may come up |
| Permanent (schema violation, bad payload, business rejection) | **No** | Retrying cannot help; DLQ immediately |

### 6.3 Retry sequence (visual)

```
Event ──► attempt 1 ──✗──► wait 1s ──► attempt 2 ──✗──► wait 4s ──► attempt 3 ──✗──► DLQ
                │                │                │                 │
                │                │                │                 ▼
                └──✓ ack─────────┴──✓ ack─────────┴──✓ ack──► done    DeadLettered → EscalationRequired
```

---

## 7. Dead Letter Queue (DLQ)

### 7.1 What enters the DLQ

- Events that failed validation (schema mismatch).
- Events that exhausted retries (3 attempts).
- Events with permanent processing errors.

### 7.2 DLQ record

Each dead-lettered event is wrapped with:

```json
{
  "dead_letter_id": "dlq-000456",
  "original_event": { "..." : "full event, unchanged" },
  "workflow_id": "7c3e1d0a-1234-4a56-9abc-def012345678",
  "reason": "exhausted_retries | schema_invalid | permanent_error",
  "attempts": 3,
  "last_error": "5xx from platform API",
  "dead_lettered_at": "2026-08-02T15:02:11.000Z",
  "correlation_id": "campaign-2026-w17"
}
```

### 7.3 DLQ lifecycle

- **Log:** written to [`logs/errors`](../../logs/errors/README.md) and the Event Store.
- **Alert:** emits `DeadLettered` infra event → Orchestrator → `EscalationRequired` if non-recoverable.
- **Replay:** a human/operator or the Orchestrator can replay a corrected event (a new event with a new `event_id` that supersedes it).
- **Expiry:** DLQ records are retained per §10 (longer than normal events, for diagnosis).

---

## 8. Agent Subscription Model

Agents never receive everything — they subscribe by interest.

### 8.1 Subscription rules

| Mechanism | How | Used for |
|---|---|---|
| **Topic** | Subscribe to a topic (e.g. `production.completed`) | Broad interest (Analytics subscribes to all completions) |
| **Targeted** | `target_agent` routing | The named consumer (e.g. `writer` gets `ResearchFinished`) |
| **Multi-consumer** | Same event type to several subscribers | `AnalyticsReported` → Finance **and** Growth |

### 8.2 The subscription map (who consumes what)

| Agent | Subscribes to | On receiving |
|---|---|---|
| CEO | `CEOReviewRequested`, `FinanceReported`, `GrowthProposed`, `EscalationRequired` | Review and decide; emit `ExecutiveDirective` |
| Orchestrator | `ExecutiveDirective`, all `*Finished`, `DeadLettered` | Dispatch, track state, retry, recover |
| Research | `TaskDispatched` (target research) | Produce brief; emit `ResearchFinished` |
| Writer | `ResearchFinished` (target writer) | Emit `ScriptFinished` |
| SEO | `ScriptFinished` (target seo) | Emit `SEOFinished` |
| Thumbnail | `SEOFinished` (target thumbnail) | Emit `ThumbnailFinished` |
| Video | `ThumbnailFinished` (target video) | Emit `VideoFinished` |
| QA | `VideoFinished` (target qa) | Emit `QAReviewed` |
| Brand | `QAReviewed` (target brand, `passed:true`) | Emit `PublishApproved` or HOLD/escalate |
| Publisher | `PublishApproved` (target publisher) | Emit `PublishingFinished` |
| Analytics | All `*Finished`/`PublishingFinished` | Emit `AnalyticsReported` |
| Finance | `AnalyticsReported` (target finance) | Emit `FinanceReported` |
| Growth | `AnalyticsReported` (target growth) | Emit `GrowthProposed` |

### 8.3 Key properties

- **No direct calls:** the map above is entirely event-based. The dotted "collaboration" lines in earlier docs are all implemented as pub/sub edges here.
- **Decoupled producers/consumers:** a new agent type (e.g. a future `Transcriber`) subscribes to the bus without any producer being rewired.
- **Single active consumer per event where required** (targeted production events); **fan-out** where useful (feedback, telemetry).

---

## 9. Workflow State Machine

### 9.1 The canonical production state machine

The pipeline is one workflow with the following states and transitions.

```
                     ┌─────────────────── WORKFLOW ───────────────────┐
                     │                                                 │
 ┌─────────┐    ┌───────────┐    ┌──────────┐    ┌──────────┐    ┌────────────┐
 │ STARTED │───►│ RESEARCH  │───►│ SCRIPT   │───►│ SEO      │───►│ THUMBNAIL  │
 └─────────┘    └───────────┘    └──────────┘    └──────────┘    └────────────┘
     ▲                │                │                │                │
     │                ▼                ▼                ▼                ▼
     │           ResearchCompleted ScriptGenerated   SEOFinished    ThumbnailFinished
     │                │                │                │                │
     └── CEO Review ◄─┤◄───────────────┼────────────────┼────────────────┤
                      ▼                ▼                ▼                ▼
                 ┌─────────┐    ┌──────────┐    ┌──────────┐    ┌───────────┐
                 │ VIDEO   │───►│ QA       │───►│ BRAND    │───►│ PUBLISHED │
                 └─────────┘    └──────────┘    └──────────┘    └───────────┘
                 VideoRendered    QAReviewed      PublishApproved PublishingCompleted
                                                     │
                                                     ▼
                                          ┌───────────────────┐
                                          │ ANALYTICS → FINANCE│──► CEO Review → repeat
                                          └───────────────────┘
```

### 9.2 States and transitions

| State | Entry event | Exit event | Failure path |
|---|---|---|---|
| `STARTED` | `WorkflowStarted` | `TaskDispatched(research)` | abort → DLQ |
| `RESEARCH` | `TaskDispatched` | `ResearchFinished` | retry ×3 → DLQ |
| `SCRIPT` | `ResearchFinished` | `ScriptFinished` | rework loop to RESEARCH on writer fail |
| `SEO` | `ScriptFinished` | `SEOFinished` | rework loop |
| `THUMBNAIL` | `SEOFinished` | `ThumbnailFinished` | rework loop |
| `VIDEO` | `ThumbnailFinished` | `VideoFinished` | re-render ×2 → DLQ |
| `QA` | `VideoFinished` | `QAReviewed` | `passed:false` → back to `VIDEO` (rework) |
| `BRAND` | `QAReviewed` | `PublishApproved` or HOLD | HOLD → rework or human |
| `PUBLISHED` | `PublishApproved` | `PublishingFinished` | partial publish → per-platform retry |
| `ANALYTICS` | `PublishingFinished` | `AnalyticsReported` | retry on data pull |
| `FINANCE` | `AnalyticsReported` | `FinanceReported` | recompute on gap |
| `CEO_REVIEW` | `FinanceReported`, `GrowthProposed` | `ExecutiveDirective` | stale package → request refresh |
| `COMPLETED` | — | — | terminal |

### 9.3 The rework loop

A gate failure (QA or Brand) is not a dead-letter; it is a state **regression**:

```
QA( passed:false ) ──► back to VIDEO state ──► re-render ──► re-enter QA
BRAND( hold ) ────────► back to SCRIPT/SEO/THUMBNAIL ──► re-enter gates
```

The loop is bounded: after the retry budget is spent, the workflow moves to `FAILED`/DLQ and the Orchestrator escalates.

---

## 10. Event Store

### 10.1 What it is

The Event Store is the durable, append-only log of every event that passed validation. It is the system of record for all workflows.

### 10.2 Responsibilities

| Responsibility | Detail |
|---|---|
| **Record** | Every published event is stored before delivery |
| **Replay** | Rebuild workflow state, re-run analytics, or rehydrate a new agent from history |
| **Audit** | Provide the tamper-evident trail for §15 |
| **Query** | By `workflow_id`, `correlation_id`, `brand_id`, `type`, time range |
| **Recover** | Feed checkpoint recovery (§11) |

### 10.3 Storage model

- **Hot store:** recent events (default 90 days) queryable at low latency.
- **Cold/archive:** older events compacted and archived (to [`data/`](../../data/README.md)) per retention, still replayable.

### 10.4 Retention summary

| Class | Retention |
|---|---|
| Hot events | 90 days |
| Archived events | Per data policy (long) |
| DLQ records | Retained longer for diagnosis (e.g. 180 days) |
| Dead-lettered & superseded | Marked, never silently deleted |

---

## 11. Checkpoint Recovery

### 11.1 Why

Workflows are long-running (research → publish spans hours or days). A crash must not restart the whole run; it must resume from the last durable checkpoint.

### 11.2 Mechanism

- The Orchestrator writes a **checkpoint** at each state boundary: the workflow id, current state, and the last event offset processed.
- Checkpoints live in [`memory/checkpoints`](../../memory/checkpoints/README.md).
- On recovery, the Orchestrator reads the checkpoint, **replays from the Event Store** up to the saved offset, and resumes the workflow in its recorded state.

```
 crash ──► read checkpoint (state=VIDEO, offset=N)
        ──► replay events [0..N] from Event Store
        ──► resume at state VIDEO, next event VideoFinished processing
        ──► no re-run of RESEARCH/SCRIPT/SEO/THUMBNAIL
```

### 11.3 Rules

- Checkpoints are **write-ahead**: the checkpoint is durable before the workflow advances, so a crash between write and advance is detectable.
- Recovery is **idempotent** (§12): replaying already-processed events has no side effects.
- Dead-lettered workflows record their checkpoint so a human can resume after a fix.

---

## 12. Idempotency Rules

At-least-once delivery means consumers may see the same event twice (retry, replay, recovery). Idempotency makes duplicates harmless.

### 12.1 The key

`event_id` (unique per event) is the idempotency key. Consumers must process an event with a given `event_id` **at most once** for its side effects.

### 12.2 Rules

| Rule | Detail |
|---|---|
| **Dedupe on `event_id`** | A consumer that has already processed `event_id` acks and skips, instead of reprocessing |
| **Side-effect idempotency** | Where dedupe is imperfect, side effects must be repeatable: "publish to YouTube" and its retry must not double-publish — the operation is keyed by `asset_id`/`event_id` (publish-if-not-exists) |
| **State transitions are idempotent** | Advancing the workflow to a state already reached is a no-op |
| **Checkpoint writes are idempotent** | Writing the same checkpoint offset twice is harmless |
| **DLQ replay** | Replaying a corrected event creates a **new** `event_id` that supersedes the dead one; the dead one is marked superseded |

### 12.3 Example

```
Event(event_id=abc) delivered twice (at-least-once):
  consumer: has abc in dedupe?  first time → no → process → store abc → ack
                                second time → yes → skip → ack
  Net effect: exactly one processing.
```

---

## 13. Correlation IDs

### 13.1 Purpose

A `workflow_id` traces one end-to-end run. A `correlation_id` groups **many** workflows that serve one business goal — a campaign, a user request, a cross-brand initiative. Without correlation IDs, the CEO review and analytics cannot see the whole story of an initiative.

### 13.2 Rules

- **Created at the source:** an external trigger (human objective, campaign) minting a `correlation_id` (e.g. `campaign-2026-w17-tech-briefs`).
- **Propagated everywhere:** every event inside those workflows carries the same `correlation_id`.
- **Never rewritten:** once set at the source, it is immutable through the run.
- **Nesting:** `correlation_id` groups many `workflow_id`s; `workflow_id` groups many `event_id`s.

```
correlation_id: campaign-2026-w17
   ├── workflow_id: w-1 (brand A topic 1)  → event_id e-1..e-n
   ├── workflow_id: w-2 (brand A topic 2)  → event_id e-1..e-m
   └── workflow_id: w-3 (brand B topic 1)  → event_id e-1..e-k
```

- Used in **every log line, DLQ record, checkpoint, and span** (§14) so the whole initiative is retrievable.

---

## 14. Distributed Tracing

### 14.1 Span model

Each event processing produces a **span** (a named unit of work): `publish`, `validate`, `deliver`, `process`, `retry`, `dead-letter`. Spans are chained across agents via the correlation/workflow ids.

### 14.2 What is traced

| Trace point | Data captured |
|---|---|
| Publish → deliver latency | Time in bus |
| Consumer processing | Duration, outcome (ack / retry / DLQ) |
| Model calls | `metadata.model`, `metadata.latency_ms`, `metadata.cost_usd` |
| Render/worker work | Render duration and cost (via `VideoFinished` metadata) |
| Gate waits | Time in QA/Brand queues |

### 14.3 Trace propagation

Every event's `metadata` carries the current span context (`trace_id`, `parent_span_id`). The bus appends delivery spans; consumers append processing spans. End-to-end:

```
trace_id: t-77
  span "publish ResearchFinished"        (research, +0ms)
  span "deliver ResearchFinished"        (bus, +12ms)
  span "process ResearchFinished"        (writer, +842ms)
  span "publish ScriptFinished"          (writer, +850ms)
  ...
```

### 14.4 Outputs

- Latency waterfall per workflow (which stage dominates the pipeline).
- Cost attribution per workflow/campaign (feeds Finance).
- Error hotspots (which stage retries/DLQs most).

---

## 15. Audit Logging

### 15.1 What is audited

| Class | What is recorded |
|---|---|
| **Events** | Every event (the Event Store IS the audit trail) |
| **Decisions** | Executive decisions recorded in [Decision Memory](../../memory/decisions/README.md) |
| **Gate rulings** | QA and Brand verdicts, including holds and escalations |
| **Publishes** | Every `PublishingFinished` with platform refs and timestamps |
| **Costs** | `metadata.cost_usd` per event; Finance ledger |
| **Escalations** | Every `EscalationRequired` and its resolution |
| **Human actions** | Operator overrides and approvals (immutable) |

### 15.2 Properties

- **Append-only and tamper-evident.** Events, decisions, and rulings are never edited or deleted; they are superseded or marked.
- **Id-keyed and searchable** by `workflow_id`, `correlation_id`, `brand_id`, `event_id`, time.
- **Human-facing where required.** For the enterprise buyers AMF serves (Elena the Enterprise Content Lead), the audit trail must answer "why was this published, by what agent, under what decision, at what cost?" — the trail above answers exactly that.

### 15.3 Audit output

Logs ship to [`logs/`](../../logs/README.md) (structured JSON lines) and to [infra/monitoring](../../infra/monitoring/README.md). The Event Store is the durable audit record; `logs/` is the operational stream.

---

## Sequence diagrams

### Sequence: production pipeline (happy path)

```
 Orchestrator    Research      Writer        SEO        Thumbnail      Video      QA      Brand     Publisher   Analytics   Finance
      │              │           │           │            │            │        │        │          │            │           │
      │─TaskDispatched────►      │           │            │            │        │        │          │            │           │
      │              │─ResearchCompleted───►│           │            │        │        │          │            │           │
      │              │           │─ScriptGenerated──►  │            │        │        │          │            │           │
      │              │           │           │─SEOFinished───────►  │        │        │          │            │           │
      │              │           │           │            │─ThumbnailFinished──►│        │          │            │           │
      │              │           │           │            │            │─VideoRendered──►│          │            │           │
      │              │           │           │            │            │        │─QAReviewed─►│          │            │           │
      │              │           │           │            │            │        │        │─PublishApproved──►│            │           │
      │              │           │           │            │            │        │        │          │─PublishingCompleted──►│           │
      │              │           │           │            │            │        │        │          │            │─AnalyticsReported──►│
      │◄─────────────────────────────────────────────────────────────────────────────── FinanceReported ───────────────│            │
```

### Sequence: rework loop (QA holds Video)

```
 Video        QA        Orchestrator      Brand       Publisher
   │          │              │              │            │
   │─VideoRendered──►        │              │            │
   │          │─QAReviewed(passed:false)──►│            │
   │          │              │─(return to VIDEO state)──│            │
   │◄─rework— │              │              │            │
   │─VideoRendered(v2)──►    │              │            │
   │          │─QAReviewed(passed:true)─────►│            │
   │          │              │              │─PublishApproved──►│
```

### Sequence: retry → DLQ → escalation

```
 Publisher        Bus           Orchestrator       DLQ      CEO
     │             │                │               │        │
     │─publish attempt 1 ──►       │               │        │
     │             │──✗──◄─ retry   │               │        │
     │─publish attempt 2 ──►       │               │        │
     │             │──✗──◄─ retry   │               │        │
     │─publish attempt 3 ──►       │               │        │
     │             │──✗──► DLQ ───►│               │        │
     │             │               │─DeadLettered──►│        │
     │             │               │─EscalationRequired───────►│
```

---

## Related documents

- [Agent Contract System](./agent-contract-system.md) — the shared envelope and per-agent contracts this bus implements
- [Memory Architecture](./memory-architecture.md) — how checkpoints, decisions, and audit fit memory
- [Packages/agents](../../packages/agents/README.md) — the agents that communicate via this bus
- [Company Brain — Decision Framework](../../memory/company/decision-framework.md) — escalation and one-way-door decisions the bus triggers
