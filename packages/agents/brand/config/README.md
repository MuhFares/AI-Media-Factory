# Brand Agent — Configuration

This folder holds the Brand agent's declarative configuration: model selection, temperature, tool allow-list, budget and rate limits, and guardrails.

Configuration files here are YAML or JSON and are environment-overridable (development, staging, production) via [configs/environments](../../../../configs/environments/README.md). No application logic lives here — only declarative settings.

Typical settings for this agent:

- A reasoning model tuned for careful, conservative judgment on voice and safety.
- Tool allow-list scoped to reading the Brand Guidelines, citation checking, and platform-policy references.
- Guardrails encoding the hard brand-safety line: safety failures cannot be auto-approved and always escalate.
