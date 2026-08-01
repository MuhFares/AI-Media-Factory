# Contributing to AI Media Factory

Thanks for taking the time to contribute.

## Workflow

1. Create a feature branch off `main`:
   ```bash
   git checkout -b feat/short-description
   ```
2. Make your changes with tests.
3. Run linting and tests locally:
   ```bash
   make lint
   make test
   ```
4. Commit using [Conventional Commits](https://www.conventionalcommits.org/):
   ```
   feat(api): add media rendering endpoint
   fix(web): correct upload progress bar
   ```
5. Open a pull request against `main`. Fill out the PR template.

## Code style

- **Python**: formatted with `ruff format`, linted with `ruff`, type-checked with `mypy`.
- **TypeScript / JS**: formatted and linted with the tooling defined per workspace.
- Respect the settings in [`.editorconfig`](./.editorconfig).

## Branching model

- `main` is always releasable.
- Feature branches: `feat/*`
- Fixes: `fix/*`
- Chores / tooling: `chore/*`

## Reporting issues

Use the issue templates under `.github/ISSUE_TEMPLATE/`. Include reproduction
steps, expected behavior, and environment details.
