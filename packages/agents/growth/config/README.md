# Growth Agent — Configuration

This folder holds the growth agent's declarative configuration: model selection, temperature, tool allow-list, budget and rate limits, and guardrails.

Configuration files here are YAML or JSON and are environment-overridable (development, staging, production) via `configs/environments`. No application logic lives here — only declarative settings.

Typical settings for this agent:

- Creative-leaning model and temperature for ideation, balanced with evaluation rigor.
- Tool allow-list scoped to analytics queries and experiment-management tools.
- Guardrails ensuring experiments respect platform policies and defined risk limits.
