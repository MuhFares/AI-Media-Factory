# Runtime Configuration

> Design of runtime-level (not agent-level) configuration. No logic.

Agent behavior comes from each agent's own `config.yaml` ([packages/agents](../../../agents/README.md)). This folder is for configuring the **engine itself** — the knobs that apply across all agents.

## Runtime-level settings

| Setting | Purpose |
|---|---|
| Provider credentials source | Read from environment ([`configs/environments`](../../../../configs/environments/README.md)); never in code or logs |
| Model catalog binding | Where logical tiers resolve to concrete vendor models ([`configs/models`](../../../../configs/models/README.md)) |
| Default retry policy | Max attempts (3), backoff schedule (1s/4s/16s jitter) — overridable per agent |
| Default timeouts | Per-turn (from agent `escalation.timeout_seconds`) and per-provider-call deadlines |
| Event bus binding | Which bus implementation `EventConsumer`/`EventEmitter` connect to |
| Memory store binding | Which vector/persistence backend `MemoryStore` uses ([packages/database](../../../database/README.md)) |
| Log/metrics sinks | Where `Logger`/`MetricsCollector` ship to ([logs](../../../../logs/README.md), [infra/monitoring](../../../../infra/monitoring/README.md)) |
| Checkpoint store | Where `CheckpointManager` writes ([memory/checkpoints](../../../../memory/checkpoints/README.md)) |

## Precedence

Agent config > runtime defaults > hard defaults. An agent can tighten a timeout or budget, but cannot loosen a runtime-enforced safety limit. Secrets always come from the environment and are never persisted or logged.
