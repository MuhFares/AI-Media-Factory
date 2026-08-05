# Context Types

> Contracts only — declarations, no logic.

| File | Defines |
|---|---|
| `workflow.ts` | `WorkflowContextSection` — workflow data, step outputs |
| `session.ts` | `SessionContextSection` — turn scratch, recent events |
| `agent-brain.ts` | `AgentBrainSection` — role, KPIs, authority |
| `company-brain.ts` | `CompanyBrainSection` — vision, mission, values, north star |

Each section is a typed component of the final `ContextPackage`.