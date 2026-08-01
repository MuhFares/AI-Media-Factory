# Configs / Models

The model catalog. This folder is the single source of truth for the models the platform can use and how requests are routed among them. It backs the AgentRouter, which selects a model per request based on capability, cost, and latency requirements.

## What belongs here

- Providers: the model providers the platform integrates with.
- Model IDs: canonical identifiers for each available model.
- Routing rules: how the AgentRouter maps a request to a model or tier.
- Cost and latency tiers: classification of models by price and response-time characteristics.

## What does not belong here

- Provider API keys or credentials. These are referenced by name and sourced from the `environments` profiles.
- Agent-specific model bindings, which reference this catalog from `configs/agents`.

## Naming conventions

- Use canonical, provider-qualified model IDs to avoid ambiguity.
- Define tiers with stable names (for example `fast`, `balanced`, `frontier`) so agent profiles can bind to a tier rather than a specific model.
