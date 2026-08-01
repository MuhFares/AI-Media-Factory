# Experiments / Workflows

Workflow and orchestration experiments. This folder holds trials of alternative pipeline structures and orchestration strategies before any promotion to the production definitions in `workflows/`.

## What belongs here

- Candidate workflow variants and the hypothesis behind each.
- Evaluation criteria covering throughput, quality, cost, and reliability.
- Results and the promotion or retirement decision.

## Lifecycle

Follow the platform experimentation loop: hypothesis, experiment, measure, promote. Variants that meet their criteria and respect guardrails are promoted into `workflows/`; others are retired with their findings recorded.

## Naming conventions

- Name each experiment by the workflow under test and a variant identifier.
- Reference the baseline workflow so comparisons are clear.
