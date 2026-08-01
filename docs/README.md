# Documentation

This directory is the single structured documentation hub for the AI Media Factory monorepo. It replaces the flat legacy `docs/architecture.md` with an organized, navigable tree of topic-specific subfolders.

The legacy `docs/architecture.md` file is retained for historical reference. Its content is being progressively expanded and migrated into `docs/architecture/`, where it will live as a set of focused, maintainable documents.

## Subfolders

| Subfolder | Purpose |
| --- | --- |
| `architecture/` | System architecture, C4-style diagrams, data flow, scaling strategy, and service boundaries. |
| `business/` | Business model, market analysis, pricing, unit economics, and go-to-market strategy. |
| `agents/` | Canonical documentation of the agent org-chart, agent contracts, and interaction protocols. |
| `api/` | API reference, OpenAPI specifications, endpoint contracts, and the authentication model. |
| `decisions/` | Architecture Decision Records (ADRs) capturing significant technical decisions. |
| `sprints/` | Sprint planning, backlog, and velocity notes. |
| `meeting-notes/` | Archive of meeting notes and outcomes. |

## Conventions

Each subfolder contains a `README.md` describing its scope and the documents it holds. New documents should be placed in the appropriate subfolder and cross-referenced from related areas of the codebase where relevant.
