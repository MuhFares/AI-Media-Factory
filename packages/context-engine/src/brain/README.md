# Brain Selection

> Contracts only — declarations, no logic.

| File | Defines |
|---|---|
| `selector.ts` | `BrainSelector`, `BrainSelection`, selection rules per agent |

The Brain Selector decides which brains to include for a given agent/task:
- **Company Brain** — always included (strategic alignment)
- **Agent Brain** — always included (role, KPIs, authority)
- **Workflow Context** — if in workflow (step outputs, data)
- **Session Context** — always (scratch memory, recent events)
- **Examples** — optional, task-dependent

Rules are defined per agent type in `BRAIN_SELECTION_RULES`.