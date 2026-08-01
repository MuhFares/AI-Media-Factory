# Analytics

## Purpose

The analytics package provides the metrics and measurement layer for the AI Media Factory. It defines KPIs, tracks events, powers the data behind dashboards, and models attribution for content performance across publishing platforms.

## Responsibilities

- Define and compute KPIs for content and workflow performance.
- Track events emitted by the apps across the media production lifecycle.
- Provide the data layer that feeds dashboards in the web app.
- Model attribution for content performance across multiple platforms.
- Aggregate and normalize metrics for reporting.

## Consumers

- `apps/web` for dashboard visualizations.
- `apps/api` for exposing metrics endpoints.
- `apps/orchestrator` for performance aware workflow decisions.

## Data Sources

- Application events emitted by the runtime apps.
- Job outcomes reported by `apps/worker`.
- Platform level performance data from external content channels.
- Historical records stored through `packages/database`.

## Roadmap

- Real time metric streaming and alerting.
- Cross platform attribution modeling.
- Configurable KPI definitions.
- Exportable reporting formats.
