# Workflows / Research

The market, topic, and keyword research pipeline. This declarative definition describes how the platform discovers and validates content opportunities that feed the content pipeline. It is executed by the orchestrator in `apps/orchestrator`.

## Stages

1. Scan: survey the market, topics, and keyword landscape.
2. Evaluate: score opportunities against demand and fit.
3. Prioritize: rank validated opportunities for production.
4. Hand off: pass prioritized topics to the content pipeline.

## What belongs here

- The declarative stage definitions and their inputs and outputs.
- Scoring and prioritization rules.

## What does not belong here

- Executable research code, which lives in the application packages.

## Naming conventions

- Name stage definitions after the stage they describe.
- Keep scoring criteria explicit so prioritization is reproducible.
