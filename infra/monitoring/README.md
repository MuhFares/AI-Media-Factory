# Infra / Monitoring

Observability configuration for the platform. This folder defines how the system is measured, monitored, and alerted so operators can understand health and behavior in production.

## What belongs here

- Logging: structured log configuration and retention policy.
- Metrics: collected measurements and aggregation rules.
- Tracing: distributed trace configuration across services and agents.
- Dashboards: definitions of operational and business views.
- Alerting: alert rules, routing, and escalation policy.
- SLOs: service level objectives and the indicators that back them.

## What does not belong here

- Application instrumentation code.
- Secrets for monitoring backends, which are sourced at runtime.

## Naming conventions

- Name dashboards and alert rules by the service or objective they cover.
- Keep SLO definitions explicit, with target, window, and error budget stated.
