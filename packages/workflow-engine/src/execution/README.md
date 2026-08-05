# Execution

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `state-machine.ts` | `WorkflowStateMachine`, state transitions | #3 |
| `scheduler.ts` | `Scheduler` — ready steps, parallel join, sequential spine | #6, #7 |
| `step-executor.ts` | `StepExecutor` — runs one step (delegates AgentStep to Runtime) | #4 |
| `router.ts` | `BranchRouter` — evaluates conditional branches | #5 |
| `compensation.ts` | `CompensationRunner` — saga rollback on failure/cancel | #15 |
| `approval.ts` | `ApprovalCoordinator` — gate pauses, human decision delivery | #16 |

The `StepExecutor` delegates `AgentStep` to the Runtime; other step kinds are executed internally. The `Scheduler` handles sequential spine + parallel fan-out/join. The `BranchRouter` evaluates branch predicates over `WorkflowContext`.