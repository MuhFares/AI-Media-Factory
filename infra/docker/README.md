# Infra / Docker

Dockerfiles and docker-compose definitions for local and development stacks. This folder packages platform services into containers and composes them into a runnable local environment.

## What belongs here

- Dockerfiles for each service image.
- docker-compose definitions that assemble the local stack.
- Container-level configuration such as base images, build stages, and health checks.

## Local stack services

- `api`: the public-facing application interface.
- `worker`: background job and task execution.
- `orchestrator`: workflow coordination across agents and services.
- `redis`: caching and message brokering.
- `db`: primary datastore.

## Naming conventions

- Name Dockerfiles by target service, for example `Dockerfile.api`, `Dockerfile.worker`.
- Keep compose files scoped by purpose, for example `docker-compose.dev.yml`.
- Do not embed secrets in images or compose files; reference environment variables sourced at runtime.
