# Infra

Infrastructure as code and operations for the AI Media Factory platform. This area defines how the system is built, packaged, deployed, and observed. Definitions here are declarative and version-controlled so environments are reproducible and auditable.

## Subfolders

| Subfolder | Purpose |
| --- | --- |
| `docker/` | Dockerfiles and docker-compose definitions for local and development stacks. |
| `github/` | Reusable GitHub Actions, composite actions, and org-level CI/CD conventions. |
| `deployment/` | Deployment topology: cloud target, IaC, orchestration, environments, and release strategy. |
| `monitoring/` | Observability: logging, metrics, tracing, dashboards, alerting, and SLOs. |
