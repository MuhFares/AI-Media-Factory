# Configs / Agents — NON_AUTHORITATIVE / DOCUMENTATION_ONLY

This directory is documentation/bootstrap material, not a branded-production
routing authority. Runtime stage identity and execution type come from the
canonical stage catalog; model routes come from active production DB routing
and must pass universal preflight. Ambient or file-local model bindings may be
used only by explicitly unbranded development/bootstrap contexts.

## What belongs here

- One configuration profile per agent role or agent type.
- Non-production examples of model or routing-tier intent.
- Tool grants: the explicit list of tools and MCP capabilities the agent is permitted to invoke.
- Budgets: token, cost, time, and iteration limits.
- Guardrails: content policies, output constraints, and escalation rules.

## What does not belong here

- Agent implementation code. That lives in the application packages.
- Authoritative production routes, model availability, or price snapshots.
- Prompt text. Prompt content is bound from the `prompts` area.
- Secrets or credentials. These are sourced from the `environments` profiles.

## Naming conventions

- Use one file per agent, named after the agent role in kebab-case, for example `research-agent`, `script-writer`, `media-generator`.
- Keep environment-specific values out of the base profile; rely on environment overrides.
