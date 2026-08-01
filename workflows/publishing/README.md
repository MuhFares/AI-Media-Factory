# Workflows / Publishing

The scheduling and multi-platform publishing pipeline. This declarative definition describes how finished content is scheduled and distributed across target platforms. It is executed by the orchestrator in `apps/orchestrator`, which coordinates the agents and services for each stage.

## Stages

1. Schedule: determine timing and target platforms for a piece.
2. Adapt: tailor the piece to each platform's requirements.
3. Publish: distribute the content to each destination.
4. Confirm: verify successful delivery and record publication.

## What belongs here

- The declarative stage definitions and their inputs and outputs.
- Platform targeting and scheduling rules.

## What does not belong here

- Executable publishing code, which lives in the application packages.
- Platform credentials, which are sourced from the environment configuration.

## Naming conventions

- Name stage definitions after the stage they describe.
- Keep platform targets explicit and consistently named.
