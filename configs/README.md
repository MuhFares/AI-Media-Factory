# Configs

Declarative configuration for the AI Media Factory platform. Every file in this area describes desired state and behavior without embedding executable logic. Values are environment-overridable: defaults live here, and environment-specific overrides are resolved at load time from the `environments` profiles and injected secrets.

## Principles

- Configuration is declarative. It states what should be true, not how to achieve it.
- Defaults are safe and explicit. No hidden fallbacks.
- Every setting is overridable per environment (development, staging, production).
- Secrets are never stored here. They are referenced by name and sourced at runtime.

## Subfolders

| Subfolder | Purpose |
| --- | --- |
| `agents/` | Per-agent runtime configuration profiles: model selection, tool access, budgets, and guardrails. |
| `mcp/` | Model Context Protocol server and client configuration, including tool registries. |
| `models/` | Model catalog covering providers, model IDs, routing rules, and cost/latency tiers (AgentRouter). |
| `prompts/` | Prompt pack configuration and default template bindings. |
| `environments/` | Per-environment configuration and secrets sourcing for development, staging, and production. |
