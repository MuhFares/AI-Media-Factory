# Sandbox

> Contracts only — declarations, no logic.

| File | Defines | Req |
|---|---|---|
| `sandbox.ts` | `ToolSandbox`, `SandboxConfig`, `SandboxLevel`, `SandboxHandle`, `SandboxInfo` | #10 |

5 isolation levels: none → process → container → vm → wasm. Configurable resource limits (memory, CPU, file descriptors, network, filesystem). Write-ahead checkpointing for recovery.