# Core

> Contracts only — declarations, no logic.

| File | Defines |
|---|---|
| `common.ts` | `Uuid`, `Timestamp`, `StepId`, `WorkflowId`, `WorkflowState` (10 states) |
| `engine.ts` | `WorkflowEngine` — start/pause/resume/cancel/signalApproval/describe (#2) |
| `instance.ts` | `WorkflowInstance`, `StepRecord`, `WorkflowState` (10 states) |

The `WorkflowEngine` is the single entry point for starting/pausing/resuming/cancelling workflows. It owns execution state but delegates execution to the Runtime, events to the Event Bus, and checkpoints to the Memory Engine.