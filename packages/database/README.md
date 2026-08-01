# Database

## Purpose

The database package is the data access layer for the AI Media Factory. It centralizes schema and migrations, ORM models, and integration with a vector store used for agent memory, giving all apps a consistent way to read and write persistent state.

## Responsibilities

- Provide the data access layer used by the apps.
- Own schema definitions and migrations.
- Define ORM models and query helpers.
- Integrate a vector store for agent memory and retrieval.
- Manage connections and transactions.

## Datastores

- Relational database for structured application state.
- Vector store for embeddings and agent memory.
- Object storage for large media assets and artifacts.

## Consumers

- `apps/api` for reading and writing application state.
- `apps/worker` for recording job results.
- `apps/orchestrator` for workflow state and agent memory.

## Roadmap

- Connection pooling and read replica support.
- Automated migration tooling.
- Multi tenant data isolation.
- Retention and archival policies.
