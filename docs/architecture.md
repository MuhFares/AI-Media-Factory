# Architecture

## Overview

AI Media Factory is a monorepo combining a Python backend service with
TypeScript apps and shared libraries. It is organized to keep the AI/media
processing core (Python) independent from the presentation and orchestration
layer (Node/TypeScript), while sharing domain types across the boundary.

## Components

### `apps/api` — Python backend
- Framework: **FastAPI** served by **uvicorn**.
- Responsibility: expose HTTP endpoints for media generation/processing jobs,
  orchestrate AI provider calls, and manage output artifacts.
- Config via `pydantic-settings` (environment-driven, see `.env.example`).
- Entry point: `ai_media_factory.main:app`.

### `apps/web` — TypeScript app
- Node/TypeScript application that consumes the API and shared package.
- Built with `tsc`; strict mode enabled.

### `packages/shared` — Shared TypeScript library
- Domain types (`MediaJob`, `MediaKind`, `JobStatus`) and small utilities.
- Consumed by `apps/web` (and future TS packages) via npm workspaces.

## Data flow

```
        ┌──────────────┐        HTTP        ┌──────────────┐
        │   apps/web    │ ────────────────▶ │   apps/api    │
        │ (TypeScript)  │ ◀──────────────── │  (FastAPI)    │
        └──────┬───────┘                    └──────┬───────┘
               │ imports types                     │ writes
               ▼                                   ▼
        ┌──────────────┐                    ┌──────────────┐
        │ packages/     │                    │  output/      │
        │ shared        │                    │ (media files) │
        └──────────────┘                    └──────────────┘
```

## Conventions

- **Line endings**: LF enforced via `.gitattributes` / `.editorconfig`.
- **Secrets**: never committed; use `.env` (git-ignored) from `.env.example`.
- **CI**: `.github/workflows/ci.yml` runs Python (ruff, mypy, pytest) and Node
  (lint, test) jobs on push and pull request.

## Future extensions

- Add worker/queue service for long-running media jobs.
- Add persistent storage (database) for job metadata.
- Expand `packages/shared` with an API client generated from the FastAPI schema.
