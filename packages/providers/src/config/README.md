# Provider Layer Configuration

> Design of how the provider layer is configured. No logic.

Providers and models are **data-driven** — nothing about a vendor is hardcoded in the layer.

| Concern | Source |
|---|---|
| API credentials | Environment ([`configs/environments`](../../../../configs/environments/README.md)): `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `MISTRAL_API_KEY` |
| Model catalog | [`configs/models`](../../../../configs/models/README.md) → loaded into the `ModelRegistry` (ids, capabilities, cost, latency, quality tier, vendor) |
| Logical tiers | Agents reference tiers (e.g. `language-tier-large`); the registry resolves them to concrete models |
| Routing strategy | Per agent/task: `cost_aware` / `latency_aware` / `balanced` |
| Rate limits | Per-provider request/token budgets |
| Retry + circuit thresholds | Provider retry attempts/backoff; health error thresholds |

## Precedence

Per-request/agent strategy > provider-layer defaults > hard defaults. Credentials always come from the environment and are never persisted or logged. Adding a provider = new adapter + a catalog entry, no code change elsewhere (req #20).
