# Orchestrator Brain

> Architecture specification for the execution engine of AI Media Factory (AMF). No application code. This is the operational counterpart to the [CEO Decision Engine](./ceo-decision-engine.md): where the CEO **decides**, the Orchestrator **executes**. It implements the runtime contract described in the [Orchestrator agent](../../packages/agents/orchestrator/README.md) on top of the [Event Bus](../../docs/architecture/event-bus.md).

## 0. Core principle

The Orchestrator is the **only** component that coordinates work, and it does so **only through events** ([Event Bus](../../docs/architecture/event-bus.md)). It receives an `ExecutiveDirective` from the CEO, decomposes it into workflows, dispatches tasks to specialist agents, tracks state, recovers failures, and reports back. It never produces content, never makes strategy, and never calls an agent directly — it publishes `TaskDispatched` events and consumes the agents' completion events.

```
   CEO ──ExecutiveDirective──►  ORCHESTRATOR BRAIN  ──TaskDispatched──►  agents
                                      │  ▲                                  │
                                      │  └────── *Finished events ──────────┘
                                      ▼
                          state · retries · checkpoints · reports · escalation
```

---

## 1. Responsibilities map

The 19 required capabilities, grouped by the function they serve.

| Group | Capabilities |
|---|---|
| **Intake** | Receive Events · Maintain Workflow Context |
| **Planning** | Maintain Workflow Graph · Handle Sequential Execution · Handle Parallel Execution · Estimate Cost · Estimate Time |
| **Dispatch** | Assign Tasks · Spawn Agents · Emit Events |
| **Tracking** | Understand Workflow State · Track Progress |
| **Control** | Cancel Workflows · Pause Workflows |
| **Resilience** | Handle Retries · Recover Failed Workflows · Resume From Checkpoints |
| **Reporting** | Generate Execution Reports · Escalate to CEO when needed |

---

## 2. The Orchestrator's mental model

```
                         ┌────────────────────────────────────────────┐
                         │              ORCHESTRATOR BRAIN              │
                         │                                              │
  ExecutiveDirective ───►│  1. INTAKE        parse directive           │
                         │        │          build Workflow Context     │
                         │        ▼                                     │
                         │  2. PLAN          build Workflow Graph        │
                         │        │          seq/parallel · cost · time  │
                         │        ▼                                     │
                         │  3. DISPATCH      TaskDispatched → agents     │
                         │        │                                     │
                         │        ▼                                     │
   *Finished events ────►│  4. TRACK         advance State Machine       │
                         │        │          update progress             │
                         │        ▼                                     │
                         │  5. RESILIENCE    retry · recover · resume     │
                         │        │                                     │
                         │        ▼                                     │
                         │  6. REPORT        execution report · escalate │
                         └────────────────────────────────────────────┘
                                  │                        │
                                  ▼                        ▼
                          Event Store / Checkpoints   CEO (escalation)
```

---

## 3. Receiving events (intake)

### 3.1 What the Orchestrator subscribes to

| Event | Meaning | Orchestrator action |
|---|---|---|
| `ExecutiveDirective` | CEO has decided | Decompose into one or more workflows |
| every `*Finished` / `QAReviewed` / `PublishApproved` / `*Reported` | An agent completed a step | Advance the workflow state |
| `DeadLettered` | An event exhausted retries | Trigger recovery or escalation |
| `CheckpointCreated` | A durable boundary was crossed | Update recovery pointer |
| Control signals (`CancelRequested`, `PauseRequested`) | Human/CEO control | Cancel or pause the workflow |

### 3.2 Intake decision tree

```
Event arrives
   │
   ├─ Is it valid against schema? ──no──► DLQ (never processed)
   │        │yes
   ├─ Is it an ExecutiveDirective? ──yes──► PLAN new workflow(s)
   │        │no
   ├─ Does it belong to a known workflow_id? ──no──► orphan → log + DLQ
   │        │yes
   ├─ Is the workflow PAUSED/CANCELLED? ──yes──► buffer or drop per policy
   │        │no
   └─ Advance the State Machine for that workflow_id
```

---

## 4. Understanding workflow state

### 4.1 The workflow state machine (canonical production pipeline)

```
 STARTED ─► RESEARCH ─► SCRIPT ─► SEO ─► THUMBNAIL ─► VIDEO ─► QA ─► BRAND ─► PUBLISHED ─► ANALYTICS ─► FINANCE ─► CEO_REVIEW ─► COMPLETED
                │           │       │        │          │      │       │
                └─ fail ────┴───────┴────────┴──────────┴──────┴───────┴──► FAILED ─► (recover | DLQ | escalate)
                                                          ▲      │
                                                          └─rework┘   (QA/Brand HOLD → regress to a prior state)
```

### 4.2 State catalogue

| State | Waiting on event | Success transition | Failure handling |
|---|---|---|---|
| STARTED | — | → RESEARCH (dispatch) | abort |
| RESEARCH | `ResearchFinished` | → SCRIPT | retry ×3 → FAILED |
| SCRIPT | `ScriptFinished` | → SEO | rework/retry |
| SEO | `SEOFinished` | → THUMBNAIL | rework/retry |
| THUMBNAIL | `ThumbnailFinished` | → VIDEO | rework/retry |
| VIDEO | `VideoFinished` | → QA | re-render ×2 → FAILED |
| QA | `QAReviewed` | passed → BRAND | not passed → regress to VIDEO |
| BRAND | `PublishApproved` | → PUBLISHED | HOLD → regress or escalate |
| PUBLISHED | `PublishingFinished` | → ANALYTICS | per-platform retry |
| ANALYTICS | `AnalyticsReported` | → FINANCE (+ GROWTH) | retry data pull |
| FINANCE | `FinanceReported` | → CEO_REVIEW | recompute |
| CEO_REVIEW | `ExecutiveDirective` | → COMPLETED / new cycle | stale → request refresh |
| PAUSED | resume signal | → prior state | timeout → escalate |
| CANCELLED | — | terminal | — |
| FAILED | — | recover/DLQ/escalate | — |

### 4.3 Workflow context (maintained per `workflow_id`)

The Orchestrator keeps a context record for every live workflow:

```json
{
  "workflow_id": "w-1042",
  "correlation_id": "campaign-2026-w17",
  "brand_id": "brd-ai-tools",
  "directive_ref": "dir-880",
  "state": "VIDEO",
  "graph_ref": "graph-1042",
  "progress": { "completed_steps": 5, "total_steps": 11, "percent": 45 },
  "cost": { "estimated_usd": 3.10, "actual_usd": 1.42 },
  "time": { "estimated_min": 22, "elapsed_min": 9 },
  "last_checkpoint_offset": 5,
  "retries": { "VIDEO": 1 },
  "status": "running"
}
```

Context is updated on every event and is the source for progress, reports, and recovery.

---

## 5. Maintaining the workflow graph (planning)

### 5.1 The graph

A workflow is a directed acyclic graph (DAG) of steps. The Orchestrator builds it from the directive, choosing sequential vs. parallel edges.

```
                     ┌──────────► SEO ──────────┐
 RESEARCH ─► SCRIPT ─┤                           ├─► VIDEO ─► QA ─► BRAND ─► PUBLISH
                     └──────────► THUMBNAIL ─────┘
   (sequential spine)        (parallel branch)        (join)   (gates)   (sequential)
```

### 5.2 Sequential vs. parallel decision

```
For each step pair (A, B):
   │
   ├─ Does B require A's output? ──yes──► SEQUENTIAL  (A → B)
   │            │no
   ├─ Do A and B share a mutable resource? ──yes──► SEQUENTIAL (serialize)
   │            │no
   └─ Independent → PARALLEL (fan-out, then join)
```

- **Sequential spine:** Research → Script → (…) → QA → Brand → Publish (each needs the prior output).
- **Parallel branch:** SEO and Thumbnail both consume the script but not each other, so they run in parallel and **join** before Video.
- **Fan-out across workflows:** many brands/topics under one `correlation_id` run as independent parallel workflows.

### 5.3 Join rule

A join step (e.g. VIDEO waiting on both SEO and Thumbnail) does not start until **all** inbound branches have emitted their completion events. Partial completion holds the join.

---

## 6. Cost & time estimation (planning)

### 6.1 Cost estimation

Before dispatching, the Orchestrator estimates workflow cost from per-step model/render costs (sourced from [`configs/models`](../../configs/models/README.md) and historical [Analytics Memory](../../memory/analytics/README.md)).

```
Estimated workflow cost = Σ (per-step model cost + render cost + tool cost)
Compared against: brand budget allocation (from CEO ExecutiveDirective, enforced by Finance)
```

Decision:

```
Estimated cost ≤ remaining brand budget? ──yes──► proceed
        │no
        └──► escalate to CEO (budget decision) BEFORE dispatch
```

### 6.2 Time estimation

```
Sequential path time = Σ step durations on the critical path
Parallel branches    = max(branch durations), not sum
Estimated time       = critical-path time + expected queue waits (from tracing history)
```

Estimates are stored in context and compared to actuals in the execution report (§12), which feeds better future estimates (Compounding Knowledge).

---

## 7. Assigning tasks, spawning agents, emitting events (dispatch)

### 7.1 Dispatch

For each ready step (dependencies satisfied), the Orchestrator emits a `TaskDispatched` event targeted at the owning agent — it never calls the agent directly.

```
Step READY (deps met, budget ok, not paused/cancelled)
   │
   ├─ Is the target agent available/healthy? ──no──► spawn/scale agent instance
   │            │yes
   └─ Emit TaskDispatched(target=agent, workflow_id, payload, retry_policy)
```

### 7.2 Spawning agents

"Spawn" is a scaling decision, not a business one:

```
Demand > capacity for agent type?
   │yes                              │no
   ▼                                 ▼
 request additional agent worker   dispatch to existing
 (apps/worker for heavy render)    consumer
```

Spawning more **agent instances** to handle load is the Orchestrator's call. "Hiring a new **agent type**" is a one-way-door decision that belongs to the CEO — the Orchestrator escalates that, it does not decide it.

### 7.3 Emitting events

Every action the Orchestrator takes is an event: `TaskDispatched`, `WorkflowStarted`, `WorkflowSucceeded`, `WorkflowFailed`, `CheckpointCreated`, `EscalationRequired`. All go through the bus and into the Event Store.

---

## 8. Tracking progress

### 8.1 Progress model

Progress = completed steps ÷ total graph steps, weighted optionally by estimated step duration.

```
[■■■■■□□□□□□]  RESEARCH ✓ SCRIPT ✓ SEO ✓ THUMBNAIL ✓ VIDEO ▶  ... 45%
```

### 8.2 Progress is derived from events, not polling

The Orchestrator never asks an agent "are you done?" It advances progress only when a completion event arrives. This keeps agents stateless and the Orchestrator authoritative.

---

## 9. Control: pause & cancel

### 9.1 Pause

```
PauseRequested(workflow_id)
   │
   ├─ Write checkpoint at current state
   ├─ Stop dispatching new steps for this workflow
   ├─ Let in-flight steps finish (or checkpoint them)
   └─ State → PAUSED   (resume later from checkpoint, §11)
```

### 9.2 Cancel

```
CancelRequested(workflow_id)
   │
   ├─ Stop dispatching
   ├─ Signal in-flight steps to abort (best-effort)
   ├─ Emit WorkflowFailed(reason: cancelled)
   ├─ Release budget reservation back to Finance
   └─ State → CANCELLED (terminal); record in audit trail
```

### 9.3 Pause vs. cancel decision

```
Is the work still wanted, just not now? ──yes──► PAUSE (resumable)
        │no
        └──► CANCEL (terminal, budget released)
```

---

## 10. Retries & failure recovery (resilience)

### 10.1 Retry (per step)

Delegated retry policy the Orchestrator owns so agents stay stateless:

```
Step fails
   │
   ├─ Is failure transient/retryable? ──no──► DLQ + FAILED
   │            │yes
   ├─ attempts < 3? ──no──► DLQ + FAILED
   │            │yes
   └─ backoff (1s, 4s, 16s jitter) → re-dispatch same step
```

### 10.2 Recover failed workflow

```
Workflow enters FAILED
   │
   ├─ Recoverable by resume? ──yes──► resume from last checkpoint (§11)
   │            │no
   ├─ Recoverable by rework? ──yes──► regress to prior state, re-dispatch
   │            │no
   └─ Not recoverable ──► EscalationRequired → CEO/human; keep DLQ context
```

### 10.3 Rework vs. retry vs. escalate

| Situation | Response |
|---|---|
| Transient error (timeout, 5xx) | **Retry** the same step (bounded) |
| Gate HOLD (QA/Brand) | **Rework** — regress to the producing state |
| Retries exhausted / permanent error | **DLQ**, then **recover** or **escalate** |
| Safety incident / budget breach / non-convergent loop | **Escalate to CEO/human** |

---

## 11. Resume from checkpoints

The Orchestrator writes a write-ahead checkpoint at each state boundary to [`memory/checkpoints`](../../memory/checkpoints/README.md).

```
 crash / pause
     │
     ▼
 read checkpoint (state = VIDEO, offset = 5)
     │
     ▼
 replay events [0..5] from Event Store (idempotent — no side effects)
     │
     ▼
 rebuild Workflow Context, resume at VIDEO
     │
     ▼
 no re-run of RESEARCH/SCRIPT/SEO/THUMBNAIL
```

Rules: checkpoint is durable **before** the workflow advances; replay is idempotent (dedupe on `event_id`); resumed workflows continue as if never interrupted.

---

## 12. Generate execution reports

### 12.1 Per-workflow report (on completion or failure)

```
Workflow w-1042  [COMPLETED]
  brand:        brd-ai-tools     correlation: campaign-2026-w17
  steps:        11/11            rework loops: 1 (QA→VIDEO)
  cost:         est $3.10  /  actual $2.74   (Δ -12%)
  time:         est 22m    /  actual 19m     (Δ -14%)
  autonomy:     10/11 steps no-human (91%)
  outcome:      published to [youtube]; asset ast-000123
  escalations:  0
```

### 12.2 Aggregate report (feeds CEO weekly review)

Per `correlation_id` and per brand: throughput, cost vs. estimate, time vs. estimate, rework rate, autonomy rate, escalation count. This is the package the CEO's [North Star evaluation](./ceo-decision-engine.md#10-north-star-evaluation) consumes. Estimate-vs-actual deltas are written back to improve future estimation.

---

## 13. Escalate to CEO

### 13.1 The Orchestrator sits at rung 3–4 of the escalation ladder

It resolves what it can (retry, rework, resume) and escalates what it cannot.

```
Can the Orchestrator resolve it itself? (retry/rework/resume)
   │yes──► resolve, no escalation
   │no
   ▼
Is it a one-way-door / strategy / budget / safety matter?
   │yes──► EscalationRequired → CEO (or human for safety)
   │no
   └──► retry once more or DLQ with context
```

### 13.2 Escalation triggers (Orchestrator → CEO)

| Trigger | Why it is the CEO's, not the Orchestrator's |
|---|---|
| Estimated cost exceeds brand budget | Budget is a CEO allocation decision |
| A new **agent type** is needed | "Hiring" is a one-way door (§7.2) |
| Non-convergent rework loop | May signal a strategy/quality problem |
| Repeated dead-letters on a brand | Possible systemic issue for CEO review |
| Safety/compliance hold from Brand | Safety escalates to CEO/human (hard line) |

The Orchestrator escalates by emitting `EscalationRequired`; it never makes the strategic call itself.

---

## 14. Worked workflow examples

### 14.1 Example A — single-brand happy path (sequential + parallel)

```
CEO ExecutiveDirective: "produce 1 asset for brd-ai-tools"
  │
  ▼
Orchestrator: build graph, estimate cost $3.10 / 22m, budget OK
  ├─ TaskDispatched → research         ► ResearchFinished
  ├─ TaskDispatched → writer           ► ScriptFinished
  ├─ TaskDispatched → seo  ┐ parallel
  ├─ TaskDispatched → thumbnail ┘      ► SEOFinished + ThumbnailFinished (join)
  ├─ TaskDispatched → video            ► VideoFinished
  ├─ (QA gate)                         ► QAReviewed passed
  ├─ (Brand gate)                      ► PublishApproved
  ├─ TaskDispatched → publisher        ► PublishingFinished
  ├─ analytics ► AnalyticsReported ; finance ► FinanceReported
  └─ Orchestrator: execution report → CEO_REVIEW → COMPLETED
```

### 14.2 Example B — multi-brand parallel fan-out (one campaign)

```
ExecutiveDirective: "3 brands, 1 asset each"  correlation=campaign-w17
   │
   ├─ workflow w-1 (brand A)  ┐
   ├─ workflow w-2 (brand B)  ├─ run in PARALLEL, independent state machines
   └─ workflow w-3 (brand C)  ┘
   Orchestrator tracks all three, aggregates a single campaign report → CEO
```

---

## 15. Failure recovery examples

### 15.1 Recovery A — transient render failure (retry)

```
VIDEO step: render times out (transient)
   ├─ attempt 1 ✗ → backoff 1s
   ├─ attempt 2 ✗ → backoff 4s
   ├─ attempt 3 ✓ → VideoFinished
   └─ workflow proceeds; report notes 1 retry, cost +$0.30
```

### 15.2 Recovery B — QA HOLD (rework loop)

```
QAReviewed(passed:false, defect: corrupt render)
   ├─ Orchestrator regresses workflow VIDEO
   ├─ TaskDispatched → video (re-render v2)
   ├─ VideoFinished(v2) → QAReviewed(passed:true)
   └─ proceeds to BRAND; report notes 1 rework loop
```

### 15.3 Recovery C — crash mid-workflow (checkpoint resume)

```
Crash during VIDEO (checkpoint at offset 5, state VIDEO)
   ├─ Orchestrator restarts
   ├─ reads checkpoint → replays events [0..5] (idempotent)
   ├─ rebuilds context, resumes at VIDEO
   └─ RESEARCH/SCRIPT/SEO/THUMBNAIL not re-run; no double-spend
```

### 15.4 Recovery D — non-recoverable (escalate)

```
Publisher fails all 3 attempts (platform API rejects: policy violation)
   ├─ DLQ with full context
   ├─ recoverable by resume? no.  by rework? Brand already approved → ambiguous
   └─ EscalationRequired → CEO/Brand: platform-policy decision (Orchestrator does not decide)
```

### 15.5 Recovery E — budget breach before dispatch (escalate)

```
Estimated cost $8.00 > remaining brand budget $5.00
   ├─ Orchestrator does NOT dispatch
   └─ EscalationRequired → CEO: approve extra budget, or defer/kill (CEO decides)
```

---

## 16. Boundaries — what the Orchestrator never does

- **Never makes strategy.** It executes the CEO's directive; it does not decide what to make or kill.
- **Never produces content.** It dispatches; the specialist agents produce.
- **Never calls an agent directly.** All coordination is events on the bus.
- **Never overrides a gate.** QA and Brand verdicts are respected; a HOLD is a rework or an escalation, never a bypass.
- **Never decides a one-way door.** Budget increases, new agent types, brand kills — all escalate to the CEO.

The Orchestrator is powerful within execution and powerless outside it. That boundary is what makes the autonomous company safe to run.

## Related documents

- [CEO Decision Engine](./ceo-decision-engine.md) — the decision counterpart that issues directives
- [Orchestrator agent contract](../../packages/agents/orchestrator/README.md) — the agent this brain animates
- [Event Bus](../../docs/architecture/event-bus.md) — the messaging backbone it coordinates over
- [Agent Contract System](../../docs/architecture/agent-contract-system.md) — the events it dispatches and consumes
- [Memory Architecture](../../docs/architecture/memory-architecture.md) — session memory and checkpoints it owns
- [Decision Framework](./decision-framework.md) — the escalation and one-way-door rules it obeys
