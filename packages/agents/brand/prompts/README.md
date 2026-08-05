# Brand Agent — Prompts

This folder holds the Brand agent's versioned system and user prompt templates.

Prompts are versioned so changes can be reviewed, evaluated, and rolled back. The shared prompt registry in [packages/prompts](../../../prompts/README.md) is the canonical source; agent-specific overrides and bindings are documented here.

Prompt families for this agent:

- `system.md` — the role: the final brand-and-safety gate, with brand safety as an absolute line.
- `instructions.md` — the step-by-step review procedure.
- `examples.md` — on-standard approve/hold/escalate examples grounded in the [Brand Guidelines](../../../../memory/company/brand-guidelines.md).
