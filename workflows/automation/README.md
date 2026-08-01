# Workflows / Automation

Cross-cutting automations and triggers. This folder holds the declarative definitions for automations that span multiple pipelines or run in response to events, rather than belonging to a single content, publishing, or research flow. They are executed by the orchestrator in `apps/orchestrator`.

## What belongs here

- Trigger definitions: the events or schedules that start an automation.
- Cross-cutting flows that connect or coordinate other pipelines.
- Conditions and actions that make up each automation.

## What does not belong here

- Executable automation code, which lives in the application packages.
- Pipeline-specific stages, which belong in their respective workflow folders.

## Naming conventions

- Name each automation by the outcome it produces.
- State the trigger and the affected pipelines explicitly in each definition.
