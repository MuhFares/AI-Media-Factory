# Model

> Contracts only — declarations, no logic.

| File | Defines |
|---|---|
| `definition.ts` | `WorkflowDefinition`, `WorkflowTrigger`, `Step` union (`AgentStep`, `BranchStep`, `ParallelStep`, `GateStep`, `CompensationStep`), `WorkflowTrigger`, `CompensationPolicy` (#1) |
| `step.ts` | Step union: `AgentStep`, `BranchStep`, `ParallelStep`, `GateStep`, `CompensationStep` (#4, #5, #6, #7, #15, #16) |
| `context.ts` | `WorkflowContext` — typed data threaded through steps, snapshotted in checkpoints |

### Step kinds

| Kind | Purpose | Req |
|---|---|---|
| `AgentStep` | Run one agent turn via the Runtime | #4 |
| `BranchStep` | Conditional next-edge selection | #5 |
| `ParallelStep` | Fan-out + join | #6 |
| `GateStep` | Human approval gate | #16 |
| `CompensationStep` | Saga rollback | #15 |

Sequential is the default edge; parallel via `ParallelStep` + join; conditional via `BranchStep` predicate on `WorkflowContext`.