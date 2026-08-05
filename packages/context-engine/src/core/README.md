# Core

> Contracts only — declarations, no logic.

| File | Defines |
|---|---|
| `common.ts` | `AgentId`, `WorkflowId`, `StepId`, `TurnId`, `MemoryId`, `PackageId`, `Timestamp`, `ContextTrigger`, `MemoryType`, `MemoryRecord`, `AgentState` |
| `engine.ts` | `ContextEngine` — single entry point: `buildContext(request) → ContextPackage` |
| `request.ts` | `ContextRequest`, `ContextOverrides`, `ContextTrigger`, `AgentState`, `MemoryRecord` |
| `package.ts` | `ContextPackage`, all 9 section types, `CacheInfo`, `CacheKey` |

The `ContextEngine` is the single entry point. It takes a `ContextRequest` and returns a complete `ContextPackage` with all 9 sections assembled, ranked, compressed, and budgeted.