# Workflows

Business and content automation pipelines for the AI Media Factory platform. The definitions in this area are conceptual and declarative, not application code. They describe the stages, inputs, outputs, and transitions of each pipeline. These declarative pipeline definitions are executed by the orchestrator in `apps/orchestrator`, which reads them and coordinates the agents and services that carry out each stage.

## Subfolders

| Subfolder | Purpose |
| --- | --- |
| `content-pipeline/` | End-to-end content creation: idea, research, script, media, assembly. |
| `publishing/` | Scheduling and multi-platform publishing. |
| `analytics/` | Performance collection and reporting loop. |
| `automation/` | Cross-cutting automations and triggers. |
| `research/` | Market, topic, and keyword research pipeline. |
