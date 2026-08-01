# Workflows / Content Pipeline

The end-to-end content creation pipeline. This declarative definition describes how an idea becomes a finished, assembled piece of media. It is executed by the orchestrator in `apps/orchestrator`, which coordinates the agents and services for each stage.

## Stages

1. Idea: capture and frame the content concept.
2. Research: gather supporting material and validate the direction.
3. Script: produce the written structure and narration.
4. Media: generate the visual and audio components.
5. Assembly: combine components into the finished piece.

## What belongs here

- The declarative stage definitions and their inputs and outputs.
- Transition rules and quality gates between stages.

## What does not belong here

- Executable pipeline code, which lives in the application packages.

## Naming conventions

- Name stage definitions after the stage they describe.
- Keep stage inputs and outputs explicit so transitions are unambiguous.
