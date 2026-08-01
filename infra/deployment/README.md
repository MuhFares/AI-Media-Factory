# Infra / Deployment

Deployment topology for the platform. This folder describes where and how the system runs across environments and defines the release strategy.

## What belongs here

- Cloud target: the provider and regions the platform deploys to.
- Infrastructure as code: Terraform or Pulumi definitions for provisioned resources.
- Orchestration: Kubernetes manifests or serverless definitions for running services.
- Environments: the mapping of infrastructure to development, staging, and production.
- Release strategy: promotion flow, rollout approach, and rollback procedures.

## What does not belong here

- Application source code.
- Runtime secrets, which are sourced from the environment's secret manager.

## Naming conventions

- Organize IaC by environment and resource domain.
- Keep environment-specific values in dedicated variable files rather than inline.
