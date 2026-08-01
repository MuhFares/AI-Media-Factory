# Infra / GitHub

Reusable GitHub Actions, composite actions, and organization-level CI/CD conventions. This folder is distinct from the repository `.github` directory: `.github` holds the active workflows that run on this repository, while this folder holds the reusable building blocks and shared conventions those workflows draw upon.

## What belongs here

- Reusable workflows intended to be called by repository workflows.
- Composite actions that encapsulate common CI/CD steps.
- Org-level conventions: standardized job names, caching strategies, versioning and release rules.

## What does not belong here

- Active repository workflow triggers, which live in `.github/workflows`.
- Secrets. Workflow secrets are configured in the platform's secret store.

## Naming conventions

- Name reusable workflows and composite actions by their function in kebab-case, for example `build-and-test`, `publish-image`.
- Version shared actions so consumers can pin to a known revision.
