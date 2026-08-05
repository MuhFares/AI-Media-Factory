# Runtime Execution State Machine

> Design of the per-turn state machine the runtime tracks. No logic — this describes the states, transitions, and where checkpoints and terminal outcomes occur.

Every agent turn — for all 13 agents — moves through the same states. Terminal states: `COMPLETED`, `FAILED`, `CANCELLED`, `ESCALATED`, `TIMED_OUT`.

## States

| State | Meaning | On success → | On failure → |
|---|---|---|---|
| `CREATED` | Turn accepted (agent + input event) | `LOADING` | — |
| `LOADING` | Config, prompts, memory, schemas loading | `CONTEXT_READY` | `FAILED` (LoadError) |
| `CONTEXT_READY` | `ExecutionContext` assembled | `INPUT_VALIDATE` | — |
| `INPUT_VALIDATE` | Input event checked vs `input.schema.json` | `AWAITING_APPROVAL` or `EXECUTING` | `FAILED` → dead-letter |
| `AWAITING_APPROVAL` | Paused for a human gate (if required) | `EXECUTING` (approved) | `ESCALATED` (rejected) |
| `EXECUTING` | Provider runs the model (timeout+cancel+cost) | `OUTPUT_VALIDATE` | `RETRYING` / `TIMED_OUT` / `CANCELLED` |
| `RETRYING` | Backoff before another attempt / failover | `EXECUTING` | `FAILED` (retries exhausted) → dead-letter |
| `OUTPUT_VALIDATE` | Model output checked vs `output.schema.json` | `SAVING` | `RETRYING` (re-prompt) / `FAILED` |
| `SAVING` | Durable memory persisted, short-term cleared | `EMITTING` | `FAILED` |
| `EMITTING` | Output event published to the bus | `COMPLETED` | `RETRYING` / `FAILED` |
| `COMPLETED` | Success (output event emitted) | terminal | — |
| `FAILED` | Terminal failure (may be dead-lettered) | terminal | — |
| `CANCELLED` | Cooperatively cancelled | terminal | — |
| `ESCALATED` | Approval rejected / escalation required | terminal | — |
| `TIMED_OUT` | Deadline exceeded, not retryable | terminal | — |

## Checkpointing

A checkpoint is written at each state boundary (via `CheckpointManager`). On restart or resume, the runtime reads the last checkpoint, replays events idempotently (dedupe by `event_id`), and continues from the recorded state — no already-completed step re-runs. `AWAITING_APPROVAL` is always checkpointed so a pending human gate survives a restart.

## Mapping to workflow states

This is the **per-turn** (single-agent) machine. It nests inside the **per-workflow** (pipeline) state machine owned by the [Orchestrator Brain](../../../memory/company/orchestrator-brain.md): each workflow state (RESEARCH, SCRIPT, ...) is one agent turn running this machine. A turn's `COMPLETED` advances the workflow; a turn's `FAILED`/`ESCALATED` triggers the workflow's recovery/escalation path.
