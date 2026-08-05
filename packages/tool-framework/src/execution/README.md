# Execution

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `invocation.ts` | `ToolInvoker`, `InvocationContext`, `ApprovalDecision`, `ResolvedCredentials`, `SandboxConfig`, `ResourceLimits`, `CancellationToken` | #6 |

The `ToolInvoker` is the single entry point for tool execution. It orchestrates the full pipeline: registry → permissions → approval → auth → sandbox → invoke → retry/timeout → validate → result.