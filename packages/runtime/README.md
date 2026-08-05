# Agent Runtime Engine (`@ai-media-factory/runtime`)

> Architecture specification for the generic execution engine of AI Media Factory (AMF). This document and the interface declarations in `src/` define **contracts only** — there is no application logic, no implementation bodies. The runtime is the bridge from the [architecture](../../docs/architecture/) and [agent contracts](../../packages/agents/README.md) into a running system.

## 0. Core principle

**One engine runs every agent.** Because all 13 agents share the same shape — a `config.yaml`, a `prompts/` set, a `memory/` pair, and `schemas/{input,output}.schema.json` — a single generic runtime can load and execute any of them with **zero agent-specific code**. The agent is *data*; the runtime is the *interpreter*.

```
   ┌─────────────────────────────────────────────────────────────┐
   │                     AGENT RUNTIME ENGINE                     │
   │   generic · agent-agnostic · one code path for all 13 agents │
   └─────────────────────────────────────────────────────────────┘
        loads ▼ (data, never code)
   ┌──────────┬──────────┬──────────┬──────────────────────────┐
   │ config   │ prompts  │ memory   │ schemas (input/output)   │
   └──────────┴──────────┴──────────┴──────────────────────────┘
        for:  ceo · orchestrator · research · writer · seo · thumbnail ·
              video · publisher · analytics · finance · growth · qa · brand
```

If a behavior differs between agents, it is expressed in that agent's **configuration and prompts**, never in the runtime. The runtime has no `if (agent === "ceo")` anywhere. This is the non-negotiable design rule.

---

## 1. What the runtime does (the 20 requirements)

Each requirement maps to a named collaborator (see [§5 Class responsibilities](#5-class-responsibilities)).

| # | Requirement | Collaborator |
|---|---|---|
| 1 | Load agent configuration | `ConfigLoader` |
| 2 | Load prompts | `PromptLoader` |
| 3 | Load memories | `MemoryLoader` / `MemoryStore` |
| 4 | Load schemas | `SchemaLoader` |
| 5 | Build execution context | `ContextBuilder` → `ExecutionContext` |
| 6 | Receive an input event | `EventConsumer` |
| 7 | Validate input schema | `SchemaValidator` |
| 8 | Execute the LLM | `LlmExecutor` + `LlmProvider` |
| 9 | Validate output schema | `SchemaValidator` |
| 10 | Save memories | `MemoryStore` |
| 11 | Emit the next event | `EventEmitter` |
| 12 | Produce logs | `Logger` |
| 13 | Produce metrics | `MetricsCollector` |
| 14 | Support retries | `RetryPolicy` |
| 15 | Support checkpoints | `CheckpointManager` |
| 16 | Human approval gates | `ApprovalGate` |
| 17 | Cancellation | `CancellationToken` |
| 18 | Timeout | `TimeoutController` |
| 19 | Cost tracking | `CostTracker` |
| 20 | Multiple LLM providers | `ProviderRegistry` (OpenAI, Anthropic, Gemini, OpenRouter) |

---

## 2. Folder structure

```
packages/runtime/
├── README.md                     # this document
├── package.json                  # TS package manifest (declarations only)
├── tsconfig.json
└── src/
    ├── index.ts                  # barrel: re-exports all contracts (types only)
    ├── interfaces/
    │   ├── README.md
    │   ├── runtime.ts            # AgentRuntime, RuntimeInput, RuntimeResult
    │   ├── loaders.ts            # ConfigLoader, PromptLoader, MemoryLoader, SchemaLoader
    │   ├── context.ts            # ExecutionContext, ContextBuilder
    │   ├── execution.ts          # LlmExecutor, ExecutionRequest, ExecutionResponse
    │   ├── validation.ts         # SchemaValidator, ValidationResult
    │   ├── memory.ts             # MemoryStore, MemoryRecord, MemoryScope
    │   ├── events.ts             # EventConsumer, EventEmitter, RuntimeEvent
    │   ├── gates.ts              # ApprovalGate, ApprovalRequest, ApprovalDecision
    │   ├── resilience.ts         # RetryPolicy, CheckpointManager, CancellationToken, TimeoutController
    │   ├── observability.ts      # Logger, MetricsCollector, CostTracker
    │   └── errors.ts             # RuntimeError taxonomy (types only)
    ├── providers/
    │   ├── README.md             # provider abstraction design
    │   ├── provider.ts           # LlmProvider interface + shared types
    │   ├── registry.ts           # ProviderRegistry, ProviderSelector
    │   ├── openai.md             # OpenAI adapter design notes
    │   ├── anthropic.md          # Anthropic adapter design notes
    │   ├── gemini.md             # Gemini adapter design notes
    │   └── openrouter.md         # OpenRouter adapter design notes
    ├── state/
    │   └── README.md             # execution state machine
    └── config/
        └── README.md             # runtime-level configuration
```

---

## 3. Execution flow

The runtime executes one agent turn as a fixed pipeline. Every agent — CEO to Brand — runs this identical path.

```
 (1) LOAD           ConfigLoader + PromptLoader + MemoryLoader + SchemaLoader
        │            read the agent's config.yaml, prompts/*, memory/*, schemas/*
        ▼
 (2) BUILD CONTEXT  ContextBuilder assembles ExecutionContext
        │            (config + resolved prompts + retrieved memory + schemas + budget)
        ▼
 (3) RECEIVE        EventConsumer delivers the input RuntimeEvent (from the bus)
        │
        ▼
 (4) VALIDATE IN    SchemaValidator checks event against input.schema.json
        │            invalid → RuntimeError(SchemaValidation) → dead-letter (no LLM call)
        ▼
 (5) APPROVAL?      ApprovalGate: does config/policy require a human gate here?
        │            yes → pause, await ApprovalDecision (approve → continue, reject → escalate)
        ▼
 (6) EXECUTE        LlmExecutor builds ExecutionRequest, ProviderRegistry selects LlmProvider,
        │            provider runs the model — under TimeoutController + CancellationToken + CostTracker
        ▼
 (7) VALIDATE OUT   SchemaValidator checks the model output against output.schema.json
        │            invalid → RetryPolicy (re-prompt) or dead-letter
        ▼
 (8) SAVE MEMORY    MemoryStore persists durable takeaways (long-term) and clears short-term
        ▼
 (9) EMIT           EventEmitter publishes the next RuntimeEvent to the bus (target_agent)
        ▼
 (10) FINALIZE      Logger writes the audit line; MetricsCollector records the run;
                    CostTracker reports spend; CheckpointManager marks the boundary
```

Cross-cutting concerns (retry, checkpoint, cancel, timeout, cost, logging, metrics) wrap **every** step, not just execution — see [§7 Error handling](#7-error-handling--retry-policy).

### 3.1 Sequence (happy path)

```
 Bus        Runtime        Loaders     Validator    Provider    Memory     Bus
  │            │              │            │            │          │         │
  │─event────► │              │            │            │          │         │
  │            │─load────────►│            │            │          │         │
  │            │◄─context─────│            │            │          │         │
  │            │─validate in──────────────►│            │          │         │
  │            │◄─ok───────────────────────│            │          │         │
  │            │─execute─────────────────────────────► │          │         │
  │            │◄─output────────────────────────────── │          │         │
  │            │─validate out─────────────►│            │          │         │
  │            │◄─ok───────────────────────│            │          │         │
  │            │─save─────────────────────────────────────────►  │         │
  │            │─emit next event───────────────────────────────────────────►│
```

---

## 4. Execution state machine

The runtime tracks one turn through these states. Terminal states are `COMPLETED`, `FAILED`, `CANCELLED`, `ESCALATED`. Full detail in [`src/state/README.md`](./src/state/README.md).

```
        ┌───────────┐
        │ CREATED   │
        └─────┬─────┘
              ▼
        ┌───────────┐     load error
        │ LOADING   │──────────────► FAILED
        └─────┬─────┘
              ▼
        ┌────────────────┐
        │ CONTEXT_READY  │
        └─────┬──────────┘
              ▼
        ┌───────────────┐   schema invalid
        │ INPUT_VALIDATE│──────────────────► FAILED (dead-letter)
        └─────┬─────────┘
              ▼ (gate required?)
        ┌───────────────┐   reject
        │ AWAITING_APPROVAL ├───────────────► ESCALATED
        └─────┬─────────┘   approve
              ▼
        ┌───────────┐   timeout / cancel
        │ EXECUTING │───────────────► TIMED_OUT / CANCELLED
        └─────┬─────┘   provider error
              │────────────────► RETRYING ──(budget left)──► EXECUTING
              ▼                        └──(exhausted)──► FAILED (dead-letter)
        ┌────────────────┐  output invalid
        │ OUTPUT_VALIDATE│──────► RETRYING / FAILED
        └─────┬──────────┘
              ▼
        ┌───────────┐
        │ SAVING    │
        └─────┬─────┘
              ▼
        ┌───────────┐
        │ EMITTING  │
        └─────┬─────┘
              ▼
        ┌───────────┐
        │ COMPLETED │
        └───────────┘

  CHECKPOINTED is written at each state boundary (▼) for resume.
```

---

## 5. Class responsibilities

Each collaborator has one responsibility. All are defined as interfaces in [`src/interfaces/`](./src/interfaces/README.md); the runtime depends on the interfaces, never on concrete implementations (dependency inversion — swappable providers, stores, buses).

| Collaborator | Single responsibility |
|---|---|
| `AgentRuntime` | Orchestrates the pipeline (§3) for one agent turn. The only entry point. |
| `ConfigLoader` | Parse and validate an agent's `config.yaml` into a typed `AgentConfig`. |
| `PromptLoader` | Load and resolve `system.md`, `instructions.md`, `examples.md`. |
| `MemoryLoader` | Retrieve relevant long-term memory (RAG) and open short-term memory for the turn. |
| `SchemaLoader` | Load `input.schema.json` and `output.schema.json` (draft-07). |
| `ContextBuilder` | Assemble the immutable `ExecutionContext` from the four loaders. |
| `EventConsumer` | Receive the input `RuntimeEvent` from the event bus. |
| `SchemaValidator` | Validate any payload against a JSON Schema; return a structured `ValidationResult`. |
| `LlmExecutor` | Turn context + input into an `ExecutionRequest`; drive the provider; return `ExecutionResponse`. |
| `ProviderRegistry` | Resolve a model id to a concrete `LlmProvider` (OpenAI/Anthropic/Gemini/OpenRouter). |
| `LlmProvider` | The uniform contract every provider adapter implements. |
| `MemoryStore` | Persist long-term takeaways; write/clear short-term; the durable side of memory. |
| `EventEmitter` | Publish the output `RuntimeEvent` to the bus with a correct envelope. |
| `RetryPolicy` | Decide whether and how to retry a failed step (bounded, backoff). |
| `CheckpointManager` | Write/read resume checkpoints at state boundaries. |
| `ApprovalGate` | Pause for human approval where policy requires; return an `ApprovalDecision`. |
| `CancellationToken` | Signal cooperative cancellation to in-flight work. |
| `TimeoutController` | Enforce per-step and per-turn deadlines. |
| `CostTracker` | Accumulate spend from provider usage; enforce the config budget ceiling. |
| `Logger` | Emit structured, correlation-keyed audit logs. |
| `MetricsCollector` | Record counters, latencies, and outcomes for observability. |

---

## 6. Integration points

The runtime does not reinvent the architecture — it plugs into it.

- **Event integration** → the [Event Bus](../../docs/architecture/event-bus.md). `EventConsumer`/`EventEmitter` speak the shared event envelope; the runtime validates every message against the agent's schemas. See [`src/interfaces/events.ts`](./src/interfaces/events.ts).
- **Memory integration** → the [Memory Architecture](../../docs/architecture/memory-architecture.md) and [Memory Intelligence](../../memory/company/memory-intelligence.md). `MemoryLoader` does confidence-ranked retrieval; `MemoryStore` writes durable lessons. Short-term is per-turn; long-term is vector-backed. See [`src/interfaces/memory.ts`](./src/interfaces/memory.ts).
- **Checkpoint integration** → [`memory/checkpoints`](../../memory/checkpoints/README.md). `CheckpointManager` enables the resume behavior the [Orchestrator Brain](../../memory/company/orchestrator-brain.md) relies on.
- **Cost integration** → the [Finance Brain](../../memory/company/finance-brain.md). `CostTracker` emits the `metadata.cost_usd` the Finance agent consumes, and enforces the `budgets` block in each `config.yaml`.
- **Provider selection** → [`configs/models`](../../configs/models/README.md). `ProviderRegistry` resolves the `model.primary`/`model.fallback` ids from config to a provider adapter.

---

## 7. Error handling & retry policy

### 7.1 Error taxonomy

All failures are typed `RuntimeError`s (see [`src/interfaces/errors.ts`](./src/interfaces/errors.ts)), classified as **retryable** or **terminal**:

| Error kind | Retryable? | Handling |
|---|---|---|
| `LoadError` (missing/invalid config, prompt, schema) | No | Terminal → `FAILED`; alert operator |
| `SchemaValidationError` (input) | No | Terminal → dead-letter (never call the LLM on bad input) |
| `SchemaValidationError` (output) | Yes (bounded) | Re-prompt via `RetryPolicy`; then dead-letter |
| `ProviderError` (timeout, 5xx, rate limit) | Yes | Backoff + retry; may fail over to `model.fallback` |
| `ProviderError` (auth, bad request) | No | Terminal → `FAILED` |
| `TimeoutError` | Policy | Retry if budget remains, else `TIMED_OUT` |
| `BudgetExceededError` | No | Terminal → escalate to Finance/CEO (Margin gate) |
| `CancellationError` | No | Terminal → `CANCELLED` (cooperative) |
| `ApprovalRejected` | No | Terminal → `ESCALATED` |

### 7.2 Retry policy

Mirrors the [Event Bus retry strategy](../../docs/architecture/event-bus.md) so runtime and bus agree:

```
 attempt fails
   │
   ├─ retryable? ──no──► classify terminal → dead-letter / escalate
   │      │yes
   ├─ attempts < max (default 3)? ──no──► dead-letter
   │      │yes
   ├─ apply backoff (exponential: 1s, 4s, 16s, jittered)
   ├─ provider error & fallback configured? → switch to model.fallback
   └─ re-enter EXECUTING
```

Retries are **idempotent** by `event_id` (the runtime dedupes so a replayed event is not double-executed) — consistent with the [idempotency rules](../../docs/architecture/event-bus.md).

### 7.3 Human approval, cancellation, timeout

- **Approval gate:** driven by the agent's `config.yaml` (e.g. Brand safety holds, CEO one-way doors). The runtime pauses in `AWAITING_APPROVAL`, checkpoints, and resumes on an `ApprovalDecision`. Rejection routes to escalation.
- **Cancellation:** cooperative via `CancellationToken`; in-flight provider calls are asked to abort, a checkpoint is written, state → `CANCELLED`.
- **Timeout:** `TimeoutController` enforces the `escalation.timeout_seconds` from config per turn and a per-provider-call deadline; expiry raises `TimeoutError`.

---

## 8. Logging & metrics

- **Logging** (`Logger`): structured JSON lines, keyed by `workflow_id`, `correlation_id`, `event_id`, and `agent_id`, shipped to [`logs/`](../../logs/README.md) and [infra/monitoring](../../infra/monitoring/README.md). Every state transition and error is logged. Secrets and raw prompt content are never logged verbatim — only references and hashes.
- **Metrics** (`MetricsCollector`): per-turn counters (success/retry/dead-letter), latencies (load, execute, total), token counts, and outcome — feeding the [Analytics Brain](../../memory/company/analytics-brain.md) and monitoring dashboards.
- **Cost** (`CostTracker`): per-turn `cost_usd` from provider usage, attributed to `agent_id`/`brand_id`/`workflow_id`, emitted in the event `metadata` and enforced against the config `budgets` ceiling.

---

## 9. Provider abstraction

The runtime supports **OpenAI, Anthropic, Gemini, and OpenRouter** behind one `LlmProvider` interface, so no agent or the executor knows which vendor runs. Full design in [`src/providers/README.md`](./src/providers/README.md).

```
        LlmExecutor
            │ speaks only the LlmProvider interface
            ▼
     ┌─────────────────────────────────────────┐
     │            ProviderRegistry               │
     │  resolves model id → adapter, w/ fallback │
     └───┬─────────┬─────────┬─────────┬─────────┘
         ▼         ▼         ▼         ▼
      OpenAI   Anthropic   Gemini   OpenRouter
      adapter   adapter    adapter   adapter
         └─────────┴─────────┴─────────┘
              each maps the uniform request/response
              to/from its vendor API (design notes only)
```

Provider selection comes from the agent `config.yaml` (`model.primary`, `model.fallback`) resolved through [`configs/models`](../../configs/models/README.md). Adding a fifth provider is a new adapter — no change to the runtime or any agent.

---

## 10. Boundaries — what the runtime never does

- **Never contains agent-specific logic.** No branching on agent id. Differences live in config and prompts.
- **Never makes business decisions.** It executes an agent turn; the agent's prompt/model decides content, the CEO decides strategy.
- **Never bypasses a schema.** Input and output are always validated; bad data never reaches the model or the bus.
- **Never calls another agent directly.** It only consumes and emits events.
- **Never hardcodes a provider.** All model access is through the `LlmProvider` abstraction.
- **Never logs secrets.** Credentials come from the environment ([`configs/environments`](../../configs/environments/README.md)); logs carry references, not values.

## 11. Status

This package currently defines **contracts and architecture only** — interface declarations and design docs. No execution logic is implemented. It is the specification an implementation will satisfy, exactly as the agent READMEs specified the agents before this runtime existed.

## Related documents

- [Event Bus](../../docs/architecture/event-bus.md) · [Agent Contract System](../../docs/architecture/agent-contract-system.md) · [Memory Architecture](../../docs/architecture/memory-architecture.md)
- Brains: [CEO](../../memory/company/ceo-decision-engine.md) · [Orchestrator](../../memory/company/orchestrator-brain.md) · [Finance](../../memory/company/finance-brain.md) · [Analytics](../../memory/company/analytics-brain.md)
- [Agents package](../agents/README.md) — the agents this runtime executes
