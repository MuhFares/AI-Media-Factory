# Configs / Environments

Per-environment configuration and secrets sourcing. This folder holds the override profiles for each deployment environment and defines where runtime secrets are obtained.

## Environments

- `development`: local and developer-facing settings. Verbose diagnostics, relaxed limits.
- `staging`: production-like settings for pre-release validation.
- `production`: hardened settings, strict budgets, and full observability.

## Secrets sourcing

- Secrets are never stored in this repository.
- Each environment profile references secrets by name only.
- Values are resolved at runtime from the environment's secret manager or injected variables.

## Naming conventions

- One profile per environment, named `development`, `staging`, and `production`.
- Keep override profiles minimal; inherit defaults from the base configuration in the parent areas.
