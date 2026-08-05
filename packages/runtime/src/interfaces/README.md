# Runtime Interfaces

> Contracts only. Every file here is TypeScript **type and interface declarations** — no implementation bodies, no logic. Concrete implementations satisfy these contracts later.

These interfaces are what make the runtime **generic**: none of them mentions a specific agent. The same contracts execute CEO, Research, Writer, SEO, Thumbnail, Video, Publisher, Analytics, Finance, Growth, QA, Brand, and Orchestrator.

## Files

| File | Defines |
|---|---|
| `common.ts` | Shared primitives (`AgentId`, `EventType`, `Uuid`, `Json`, `Timestamp`) |
| `runtime.ts` | `AgentRuntime` (the single entry point), `RuntimeInput`, `RuntimeResult`, `TurnStatus` |
| `loaders.ts` | `ConfigLoader`, `PromptLoader`, `SchemaLoader`, `MemoryLoader` + `AgentConfig`, `PromptSet`, `AgentSchemas` |
| `context.ts` | `ExecutionContext`, `ContextBuilder` |
| `execution.ts` | `LlmExecutor`, `ExecutionRequest`, `ExecutionResponse`, `Usage` |
| `validation.ts` | `SchemaValidator`, `ValidationResult`, `JsonSchema` |
| `memory.ts` | `MemoryStore`, `MemoryLoader` support, `MemoryRecord`, `LoadedMemory`, `MemoryScope` |
| `events.ts` | `RuntimeEvent` (the shared envelope), `EventConsumer`, `EventEmitter`, `EventMetadata` |
| `gates.ts` | `ApprovalGate`, `ApprovalRequest`, `ApprovalDecision` |
| `resilience.ts` | `RetryPolicy`, `CheckpointManager`, `CancellationToken`, `TimeoutController`, `Checkpoint` |
| `observability.ts` | `Logger`, `MetricsCollector`, `CostTracker` |
| `errors.ts` | `RuntimeError` taxonomy + `RuntimeErrorKind` |

## Dependency direction

`AgentRuntime` depends on these **interfaces**, never on concrete classes. That inversion is what lets the same runtime swap providers (OpenAI ↔ Anthropic ↔ Gemini ↔ OpenRouter), memory stores, and event buses without changing the pipeline. See the parent [README](../../README.md).
