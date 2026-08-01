# Workflows / Analytics

The performance collection and reporting loop. This declarative definition describes how the platform gathers performance data on published content and turns it into reporting that informs the next production cycle. It is executed by the orchestrator in `apps/orchestrator`.

## Stages

1. Collect: gather performance data from publishing platforms.
2. Aggregate: roll up events into metrics and dimensions.
3. Report: produce the views and summaries stakeholders consume.
4. Feed back: route findings into research and content planning.

## What belongs here

- The declarative stage definitions and their inputs and outputs.
- The metrics and reporting cadence the loop produces.

## What does not belong here

- Executable collection and reporting code, which lives in the application packages.
- Stored analytics data, which lives in `data/analytics`.

## Naming conventions

- Name stage definitions after the stage they describe.
- Keep metric names consistent with the definitions in `data/analytics`.
