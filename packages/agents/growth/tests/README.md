# Growth Agent — Tests

This folder holds eval-style tests for the growth agent. These are placeholders for now; no logic is implemented yet.

Planned test categories:

- **Prompt regression** — detect behavioral drift when prompts or models change.
- **Output schema validation** — ensure experiment definitions and proposals conform to the shared schemas in `schemas/`.
- **KPI / behavioral evals** — verify experiment quality, guardrail adherence, and that only statistically valid wins are promoted.
