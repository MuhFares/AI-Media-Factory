# Experiments / Prompts

Prompt experiments. This folder holds candidate prompt variants under evaluation before any promotion to the active prompt configuration in `configs/prompts`.

## What belongs here

- Prompt variants paired with the hypothesis they test.
- Evaluation criteria and the metrics used to judge each variant.
- Results and the promotion or retirement decision.

## Lifecycle

Follow the platform experimentation loop: hypothesis, experiment, measure, promote. A variant that meets its criteria and respects guardrails is promoted into `configs/prompts`; others are retired with their findings recorded.

## Naming conventions

- Name each experiment by the prompt under test and a variant identifier.
- Reference the baseline explicitly so comparisons are clear.
