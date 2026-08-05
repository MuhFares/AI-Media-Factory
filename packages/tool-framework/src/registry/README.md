# Registry

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `registry.ts` | `ToolRegistry`, `ValidationReport`, `ValidationError`, `ValidationWarning` | #1 |

The `ToolRegistry` is the central catalog of all available tools. It validates tool specs on registration and provides lookup by ID, category, or agent permissions.