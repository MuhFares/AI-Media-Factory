# Configs / Agents

Per-agent runtime configuration profiles. Each profile declares how an individual agent behaves at runtime: which model it uses, which tools it may call, its resource budgets, and the guardrails that constrain its actions.

## What belongs here

- One configuration profile per agent role or agent type.
- Model binding: the model or routing tier the agent should use.
- Tool grants: the explicit list of tools and MCP capabilities the agent is permitted to invoke.
- Budgets: token, cost, time, and iteration limits.
- Guardrails: content policies, output constraints, and escalation rules.

## What does not belong here

- Agent implementation code. That lives in the application packages.
- Prompt text. Prompt content is bound from the `prompts` area.
- Secrets or credentials. These are sourced from the `environments` profiles.

## Naming conventions

- Use one file per agent, named after the agent role in kebab-case, for example `research-agent`, `script-writer`, `media-generator`.
- Keep environment-specific values out of the base profile; rely on environment overrides.
