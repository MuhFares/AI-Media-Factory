# Configs / Models — NON_AUTHORITATIVE / DOCUMENTATION_ONLY

This directory is not a production runtime authority. For branded production,
the active `production_model_routing_versions` / `production_model_routing_entries`
rows are the sole route authority, and `provider_model_catalog` plus immutable
price snapshots are the preflight evidence. Files here may document or seed
development configuration only; they must never override an active DB route.

## What belongs here

- Providers: the model providers the platform integrates with.
- Model IDs: canonical identifiers for each available model.
- Non-production examples of routing concepts and tiers.
- Cost and latency tiers: classification of models by price and response-time characteristics.

## What does not belong here

- Provider API keys or credentials. These are referenced by name and sourced from the `environments` profiles.
- Authoritative branded-project model bindings or availability truth.

## Naming conventions

- Use canonical, provider-qualified model IDs to avoid ambiguity.
- Define tiers with stable names (for example `fast`, `balanced`, `frontier`) so agent profiles can bind to a tier rather than a specific model.
