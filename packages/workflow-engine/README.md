# Workflow Engine (`@ai-media-factory/workflow-engine`)

> Architecture specification for the workflow orchestration layer of AI Media Factory (AMF). **Contracts and architecture only** — the `src/**/*.ts` files are type/interface declarations with no implementation bodies. This package implements the per-workflow control described in the [Orchestrator Brain](../../memory/company/orchestrator-brain.md) on top of the [Event Bus](../../docs/architecture/event-bus.md), the [Runtime](../runtime/README.md), and the [Memory Engine](../memory-engine/README.md).

## 0. Core principle — separation of concerns

Four layers, four jobs. The Workflow Engine is the **conductor**; it never plays an instrument.

```
   ┌────────────────────────────────────────────────────────────────┐
   │  WORKFLOW ENGINE  — owns EXECUTION STATE + the business process  │
   └───────────────┬───────────────────────────┬────────────────────┘
                   │ per step, calls            │ transports events via
                   ▼                            ▼
        ┌────────────────────┐        ┌────────────────────┐
        │   RUNTIME           │        │   EVENT BUS         │
        │ executes ONE agent  │        │ moves events        │
        │ turn (a step)       │        └────────────────────┘
        └─────────┬──────────┘
                  │ load/save via
                  ▼
        ┌────────────────────┐
        │  MEMORY ENGINE      │  (checkpoints, session/workflow memory)
        └────────────────────┘
```

- **Workflow Engine** — owns workflow definitions, instances, and **execution state**. Decides *what step runs next* and *under what conditions*. This package.
- **Runtime** — executes a single agent turn when the engine tells it to. Owns the *per-turn* state machine.
- **Event Bus** — transports events between everything. Owns delivery/retry/DLQ at the message layer.
- **Memory Engine** — persists checkpoints, session, and workflow memory.

The engine **coordinates**; it does not execute agents, transport events, or store memory itself. It calls the runtime, publishes/consumes on the bus, and checkpoints through the memory engine. Dependency direction is one-way: `workflow-engine → runtime`, `workflow-engine → memory-engine`. It imports nothing from them that would create a cycle.

---

## 1. The 20 requirements → where each lives

| # | Requirement | Home |
|---|---|---|
| 1 | Workflow definitions | `model/definition.ts` (`WorkflowDefinition`) |
| 2 | Workflow execution | `core/engine.ts` (`WorkflowEngine`) |
| 3 | State Machine | `execution/state-machine.ts` |
| 4 | Step execution | `execution/step-executor.ts` (calls the runtime) |
| 5 | Conditional branches | `model/step.ts` (`BranchStep`) + `execution/router.ts` |
| 6 | Parallel execution | `execution/scheduler.ts` (fan-out/join) |
| 7 | Sequential execution | `execution/scheduler.ts` (the spine) |
| 8 | Retry policies | `resilience/retry.ts` |
| 9 | Checkpoints | `resilience/checkpoint.ts` (binds Memory Engine) |
| 10 | Resume execution | `resilience/recovery.ts` |
| 11 | Pause | `core/engine.ts` (`pause()`) + state machine |
| 12 | Cancel | `core/engine.ts` (`cancel()`) + compensation |
| 13 | Timeouts | `resilience/timeout.ts` |
| 14 | Dead Letter Queue | `resilience/dead-letter.ts` |
| 15 | Compensation steps | `execution/compensation.ts` (saga) |
| 16 | Human approval gates | `execution/approval.ts` |
| 17 | Event integration | `integration/events.ts` |
| 18 | Metrics | `observability/metrics.ts` |
| 19 | Logging | `observability/logging.ts` |
| 20 | Audit trail | `observability/audit.ts` |

---

## 2. Folder structure

```
packages/workflow-engine/
├── README.md
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts                    # barrel (types only)
    ├── core/
    │   ├── README.md
    │   ├── engine.ts               # WorkflowEngine — start/pause/resume/cancel/signal
    │   └── instance.ts             # WorkflowInstance — a running definition + its state
    ├── model/
    │   ├── README.md
    │   ├── definition.ts           # WorkflowDefinition, WorkflowVersion (#1)
    │   ├── step.ts                 # Step union: AgentStep, BranchStep, ParallelStep, GateStep, CompensationStep (#4,5,6,7,15,16)
    │   └── context.ts              # WorkflowContext — data passed across steps
    ├── execution/
    │   ├── README.md
    │   ├── state-machine.ts        # workflow-level states + transitions (#3)
    │   ├── scheduler.ts            # sequential spine + parallel fan-out/join (#6,#7)
    │   ├── step-executor.ts        # runs one step (delegates agent steps to the Runtime) (#4)
    │   ├── router.ts               # evaluates conditional branches (#5)
    │   └── compensation.ts         # saga rollback of completed steps (#15)
    ├── resilience/
    │   ├── README.md
    │   ├── retry.ts                # step/workflow retry policy (#8)
    │   ├── timeout.ts              # per-step + per-workflow deadlines (#13)
    │   ├── checkpoint.ts           # checkpoint at boundaries via Memory Engine (#9)
    │   ├── recovery.ts             # resume from checkpoint (#10)
    │   └── dead-letter.ts          # non-recoverable workflows → DLQ (#14)
    ├── integration/
    │   ├── README.md
    │   └── events.ts               # bind Event Bus consume/emit (#17)
    └── observability/
        ├── README.md
        ├── metrics.ts              # workflow metrics (#18)
        ├── logging.ts              # structured logging (#19)
        └── audit.ts                # audit trail (#20)
```

---

## 3. Workflow model

### 3.1 Workflow definition (#1)

A workflow is a **versioned, declarative graph of steps** — data, not code. It maps to the declarative pipelines under [`workflows/`](../../workflows/README.md) (content-pipeline, publishing, analytics, ...).

```
WorkflowDefinition
  ├─ id, version                     # versioned; a running instance pins its version
  ├─ trigger                         # what starts it (ExecutiveDirective, schedule, event)
  ├─ steps: Step[]                   # the graph nodes
  ├─ edges                           # sequential/parallel/conditional links
  ├─ timeout                         # whole-workflow deadline
  └─ compensation                    # saga policy for rollback on failure
```

### 3.2 Step model (#4)

A `Step` is a union covering every control-flow need:

| Step kind | Purpose | Req |
|---|---|---|
| `AgentStep` | Run one agent turn via the Runtime (e.g. Research, Writer) | #4 |
| `BranchStep` | Conditional: choose the next path from a predicate on context | #5 |
| `ParallelStep` | Fan out N branches, join when all complete | #6 |
| `GateStep` | Human approval gate — pause until decided | #16 |
| `CompensationStep` | Undo a previously completed step (saga) | #15 |

Sequential execution (#7) is the default edge between steps; a `ParallelStep` introduces concurrency with an explicit join.

### 3.3 Workflow context

`WorkflowContext` is the typed data bag threaded through steps (brand_id, correlation_id, accumulated step outputs). Steps read/write context; the engine persists it in checkpoints so a resumed workflow sees the same context.

---

## 4. Execution lifecycle

```
 define ─► instantiate ─► schedule next ready step(s)
                              │
                              ▼
              ┌─── step is AgentStep? ──► StepExecutor → Runtime.run(turn) ──► RuntimeResult
              ├─── step is BranchStep? ─► Router evaluates predicate → pick edge
              ├─── step is ParallelStep? ► Scheduler fans out → awaits join
              ├─── step is GateStep? ────► pause (AWAITING_APPROVAL) → decision
              └─── step is Compensation? ► rollback prior step
                              │
                              ▼ after each step: CHECKPOINT (via Memory Engine)
                              ▼
              advance state machine ─► more steps? ── yes ─► (loop)
                              │                      no
                              ▼
                         COMPLETED  (emit WorkflowSucceeded)
```

Every step boundary is a checkpoint. A crash resumes from the last checkpoint; already-completed steps do not re-run (idempotent replay, dedupe by event/step id).

---

## 5. Workflow state machine (#3)

The engine owns the **per-workflow** state machine (distinct from the runtime's per-turn machine, which runs *inside* an `AgentStep`).

```
        ┌──────────┐
        │ PENDING  │  (defined, not started)
        └────┬─────┘
             ▼
        ┌──────────┐   step fails, retries left
        │ RUNNING  │◄───────────────┐
        └────┬─────┘                 │
   ┌─────────┼───────────┬───────────┤
   ▼         ▼           ▼           │
┌────────┐ ┌───────┐ ┌──────────┐    │ retry
│ PAUSED │ │AWAIT_ │ │ RETRYING ├────┘
│        │ │APPROVAL│ └────┬─────┘
└───┬────┘ └───┬───┘       │ retries exhausted
    │ resume   │ approve   ▼
    └────►RUNNING◄─┘   ┌──────────────┐  compensation?
                       │ COMPENSATING │◄─ yes ─ FAILED trigger
                       └──────┬───────┘
                              ▼
   reject/expire ─► ESCALATED │
   cancel ────────► CANCELLED │
                              ▼
                       ┌──────────┐   ┌──────────┐
                       │  FAILED  │   │COMPLETED │
                       └────┬─────┘   └──────────┘
                            ▼
                          DLQ (non-recoverable) + escalate
```

| State | Meaning | Terminal? |
|---|---|---|
| PENDING | Instantiated, not started | no |
| RUNNING | Executing steps | no |
| PAUSED | Human/CEO paused (#11) | no |
| AWAITING_APPROVAL | Blocked on a GateStep (#16) | no |
| RETRYING | Step failed, backing off (#8) | no |
| COMPENSATING | Rolling back completed steps (#15) | no |
| COMPLETED | All steps done | yes |
| FAILED | Unrecoverable (→ DLQ #14) | yes |
| CANCELLED | Cancelled (#12), compensation run | yes |
| ESCALATED | Approval rejected / escalation required | yes |

---

## 6. Sequential, parallel, conditional (#5–#7)

```
 SEQUENTIAL (spine):   Research → Writer → SEO → ... → Publisher

 PARALLEL (fan-out/join):
        Writer ─┬─► SEO ───────┐
                └─► Thumbnail ──┴─► (join) ─► Video

 CONDITIONAL (branch):
        QA ─► BranchStep(passed?) ─┬─ true ──► Brand
                                   └─ false ─► Video (rework)
```

- **Sequential** is the default edge; a step starts when its predecessor completes.
- **Parallel** (`ParallelStep`) fans out independent branches and **joins** — the join step waits for *all* branches (matches the SEO+Thumbnail branch in the content pipeline).
- **Conditional** (`BranchStep`) picks the next edge from a predicate over `WorkflowContext` — this is how the QA/Brand **rework loop** is modeled (a gate failure branches back to a prior step).

---

## 7. Resilience

### 7.1 Retry policy (#8)
Step-level, bounded, backed-off — aligned with the [Event Bus](../../docs/architecture/event-bus.md) and runtime policies: max 3 attempts, exponential backoff (1s/4s/16s jitter). Retryable vs terminal is classified from the step's error. On exhaustion → compensation or DLQ.

### 7.2 Checkpoints (#9) & resume (#10)
The engine writes a checkpoint at **every step boundary** through the Memory Engine's `CheckpointStore` (it does **not** define its own checkpoint storage — single source of truth). A checkpoint holds: workflow id, current state, completed steps, context snapshot, and last event offset. Recovery replays from the last checkpoint; completed steps are skipped (idempotent).

### 7.3 Pause (#11) & cancel (#12)
- **Pause:** stop scheduling new steps, checkpoint, let in-flight steps finish → `PAUSED`. Resume continues from checkpoint.
- **Cancel:** stop scheduling, signal in-flight steps to abort, run **compensation** for completed steps, release resources → `CANCELLED`.

### 7.4 Timeouts (#13)
Per-step deadline (from the agent's config `timeout_seconds`) and a whole-workflow deadline (from the definition). Expiry raises a timeout error handled by the retry/compensation path.

### 7.5 Dead Letter Queue (#14)
A workflow that exhausts retries and cannot be compensated is moved to the DLQ with full context (definition version, failed step, error, checkpoint ref) and an `EscalationRequired` event is emitted to the CEO/human. Reuses the bus DLQ semantics; the workflow engine records the workflow-level dead-letter.

### 7.6 Compensation / saga (#15)
When a workflow fails or is cancelled after some steps completed, the engine runs their `CompensationStep`s in reverse order to undo side effects (e.g. un-publish, release a budget reservation). Compensation is best-effort and itself audited.

---

## 8. Human approval gates (#16)

A `GateStep` puts the workflow into `AWAITING_APPROVAL`, checkpoints, and waits for an `ApprovalDecision` (the same approval contract the runtime uses). Approve → continue; reject → `ESCALATED`. Because it is checkpointed, a pending approval survives a restart. Used for CEO one-way doors and Brand safety holds.

---

## 9. Event integration (#17)

The engine binds to the [Event Bus](../../docs/architecture/event-bus.md) ([`integration/events.ts`](./src/integration/events.ts)):

- **Consumes:** triggers (`ExecutiveDirective`, scheduled triggers), step-completion events (`*Finished`, `QAReviewed`, ...), `DeadLettered`.
- **Emits:** `WorkflowStarted`, `WorkflowSucceeded`, `WorkflowFailed`, `CheckpointCreated`, `EscalationRequired`, and the `TaskDispatched` that drives each `AgentStep`.

The engine never calls an agent directly — an `AgentStep` is dispatched as an event and its completion event advances the workflow. This is exactly the Orchestrator behavior from the [Orchestrator Brain](../../memory/company/orchestrator-brain.md).

---

## 10. Observability

- **Metrics (#18):** per-workflow cycle time, step latencies, retry/rework counts, parallel-branch timings, success/failure/DLQ rates, autonomy rate, estimate-vs-actual cost/time. → [infra/monitoring](../../infra/monitoring/README.md) + [Analytics Brain](../../memory/company/analytics-brain.md).
- **Logging (#19):** structured, correlation-keyed (`workflow_id`, `correlation_id`, step id); every state transition logged; no secrets.
- **Audit trail (#20):** append-only record of every workflow decision — which step ran, which branch was taken, approvals, compensations, and terminal outcome. Backed by workflow memory in the Memory Engine and the Event Store; answers "why did this workflow do what it did?" for enterprise governance.

---

## 11. Boundaries — what the engine never does

- **Never executes an agent itself** — it dispatches `AgentStep`s to the Runtime via events.
- **Never transports events itself** — it uses the Event Bus.
- **Never stores memory/checkpoints itself** — it uses the Memory Engine.
- **Never makes business/strategy decisions** — it runs the defined process; the CEO decides strategy, gates decide approvals.
- **Never overrides a gate** — a GateStep rejection escalates; it is not bypassed.
- **Never mutates a running instance's pinned definition version** — a new version applies to new instances only.

## Status

Contracts and architecture only. No implementation. This is the specification a workflow-engine implementation will satisfy.

## Related documents

- [Orchestrator Brain](../../memory/company/orchestrator-brain.md) — the behavior this engine implements
- [Event Bus](../../docs/architecture/event-bus.md) — the transport + DLQ semantics it reuses
- [Runtime](../runtime/README.md) — executes each AgentStep
- [Memory Engine](../memory-engine/README.md) — checkpoints + workflow/session memory
- [workflows/](../../workflows/README.md) — the declarative pipelines this engine runs
- [Agent Contract System](../../docs/architecture/agent-contract-system.md) — the events steps exchange
