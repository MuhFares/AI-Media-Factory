# Prompts

## Purpose

The prompts package is the centralized, versioned prompt registry for the AI Media Factory. It holds prompt templates and references to the evaluation harness so that prompts are managed, versioned, and tested consistently across all agents and workflows.

## Responsibilities

- Maintain a centralized registry of prompts.
- Store reusable prompt templates.
- Version prompts and track changes over time.
- Reference the evaluation harness for prompt testing.
- Provide a consistent way for consumers to resolve prompts.

## Structure

- Templates grouped by domain and agent role.
- Metadata describing inputs, variables, and intended use.
- Version records for each prompt.
- Evaluation references linking prompts to test cases.

## Versioning Strategy

Prompts are versioned so that changes are traceable and reversible. Each prompt carries a version identifier, and consumers can pin to a specific version or track the latest. Changes are recorded to support comparison and rollback.

## Consumers

- `apps/orchestrator` for prompts used during workflow execution.
- `packages/agents` for role and capability prompts.

## Roadmap

- Automated prompt evaluation pipelines.
- A/B testing of prompt versions.
- Prompt performance tracking tied to analytics.
- Localization of prompt templates.
