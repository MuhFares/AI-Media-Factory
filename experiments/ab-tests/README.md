# Experiments / A/B Tests

A/B tests on content and product. This folder holds controlled comparisons between variants served to distinct audiences, with metrics and guardrails defined before launch.

## What belongs here

- Test definitions: the variants, the audience split, and the hypothesis.
- Metrics: the primary success metric and supporting measures.
- Guardrails: the limits that halt a test if a variant causes harm to key metrics.
- Results and the decision to promote, iterate, or retire.

## Lifecycle

Follow the platform experimentation loop: hypothesis, experiment, measure, promote. A winning variant that respects its guardrails is promoted; losing or harmful variants are retired with their findings recorded.

## Naming conventions

- Name each test by the surface under test and a test identifier.
- State the primary metric and guardrails explicitly in the test definition.
