# Finance Agent — Configuration

This folder holds the finance agent's declarative configuration: model selection, temperature, tool allow-list, budget and rate limits, and guardrails.

Configuration files here are YAML or JSON and are environment-overridable (development, staging, production) via `configs/environments`. No application logic lives here — only declarative settings that define how the agent behaves at runtime.

Typical settings for this agent:

- Reasoning model and temperature tuned for numerical accuracy and consistency.
- Tool allow-list scoped to cost/revenue data sources and reporting tools.
- Hard spend and rate limits, plus guardrails preventing budget approval by the agent itself.
