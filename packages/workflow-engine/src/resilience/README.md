# Resilience

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `retry.ts` | `WorkflowRetryPolicy` — bounded, backed-off retries (aligned with Event Bus/Runetime) | #8 |
| `timeout.ts` | `TimeoutController` — per-step + per-workflow deadlines | #13 |
| `checkpoint.ts` | `CheckpointCoordinator` — writes at step boundaries via Memory Engine | #9 |
| `recovery.ts` | `RecoveryManager` — resume from checkpoint, idempotent replay | #10 |
| `dead-letter.ts` | `DeadLetterSink` — workflow-level DLQ, escalation event | #14 |

Checkpoints are written at every step boundary via the Memory Engine's `CheckpointStore`. On recovery, the engine rebuilds from the last checkpoint and replays events idempotently (dedupe by step/event id). Retries happen within a step; after exhaustion, the router advances the fallback/compensation path.