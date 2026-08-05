# Integration

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `events.ts` | `WorkflowEventBridge` — inbound/outbound event types, consume/emit | #17 |

The workflow engine coordinates via events; it never calls an agent directly. An `AgentStep` is dispatched as an event (`TaskDispatched` via the runtime) and its completion event (`*Finished`, `QAReviewed`, etc.) advances the workflow. Mirrors the Orchestrator behavior from the [Orchestrator Brain](../../../memory/company/orchestrator-brain.md) and uses the [Event Bus](../../../../docs/architecture/event-bus.md).