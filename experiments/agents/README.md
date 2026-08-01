# Experiments / Agents

Agent behavior experiments. This folder holds trials of alternative agent configurations and behaviors before any promotion to the active profiles in `configs/agents`.

## What belongs here

- Candidate agent configuration variants and the hypothesis behind each.
- Evaluation criteria covering quality, cost, and latency.
- Results and the promotion or retirement decision.

## Lifecycle

Follow the platform experimentation loop: hypothesis, experiment, measure, promote. Variants that meet their criteria and respect guardrails are promoted into `configs/agents`; others are retired with their findings recorded.

## Naming conventions

- Name each experiment by the agent under test and a variant identifier.
- Reference the baseline profile so comparisons are clear.
