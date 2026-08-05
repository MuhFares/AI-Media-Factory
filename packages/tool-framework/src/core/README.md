# Core

> Contracts only — declarations, no logic.

| File | Defines |
|---|---|
| `common.ts` | `ToolId`, `AgentId`, `WorkflowId`, `StepId`, `InvocationId`, `TraceId`, `CorrelationId`, `Timestamp`, `Json`, `ToolCategory`, `Permission`, `SandboxLevel`, `Duration` |
| `tool.ts` | `ToolSpec`, `Tool`, `ToolMetadata`, `ToolHealth`, `InvocationContext`, `ToolInput`, `CancellationToken`, `ApprovalDecision`, `ResolvedCredentials`, `SandboxConfig`, `ResourceLimits`, `SandboxConfig`, `ApprovalDecision` |
| `execution.ts` | `InvocationContext`, `ApprovalDecision`, `ResolvedCredentials`, `SandboxConfig`, `ResourceLimits`, `CancellationToken`, `ToolResult`, `ToolError`, `ExecutionMetadata`, `TokenUsage`, `SandboxInfo` |
| `tool.ts` | `ToolSpec`, `Tool`, `ToolMetadata`, `ToolHealth`, `InvocationContext`, `ToolInput`, `CancellationToken`, `ApprovalDecision`, `ResolvedCredentials`, `SandboxConfig`, `ResourceLimits`, `ApprovalDecision` |

The Tool Framework is designed so the Runtime never calls tools directly. All tool execution goes through the `ToolInvoker` which enforces the full pipeline: registry → permissions → approval → auth → sandbox → invocation → retry/timeout → validation → result.