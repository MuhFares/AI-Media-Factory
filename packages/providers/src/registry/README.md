# Registries

> Contracts only — declarations, no logic.

| File | Defines | Requirement |
|---|---|---|
| `provider-registry.ts` | `ProviderRegistry` — register/look up provider adapters | #2 |
| `model-registry.ts` | `ModelRegistry`, `ModelDescriptor` — the model catalog + capabilities, tier resolution | #3, #4 |

Both are populated from [`configs/models`](../../../configs/models/README.md). Agents reference **logical tiers** (e.g. `language-tier-large`); `ModelRegistry.resolveTier()` turns a tier into concrete candidate models across providers, which the [router](../routing/README.md) then filters and ranks.
