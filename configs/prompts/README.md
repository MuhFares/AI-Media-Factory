# Configs / Prompts

Prompt pack configuration and default template bindings. This folder configures which prompt packs are active and binds named templates to the roles and agents that consume them.

## What belongs here

- Prompt pack registration: which packs are available and their versions.
- Default bindings: mapping of logical prompt names to concrete templates.
- Selection rules: how a template is chosen per agent, task, or environment.

## What does not belong here

- Prompt experiment variants under evaluation, which live in `experiments/prompts`.
- Executable prompt-assembly code.

## Naming conventions

- Reference templates by stable logical names so bindings can change without touching consumers.
- Version prompt packs explicitly so bindings can pin to a known revision.
