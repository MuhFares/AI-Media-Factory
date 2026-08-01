# Experiments

The experimentation area for the AI Media Factory platform. This is where changes are validated before they reach production. The platform treats experimentation as a disciplined loop rather than ad hoc trial.

## Experimentation strategy

1. Hypothesis: state a clear, measurable expectation about a change.
2. Experiment: implement the variant in isolation, scoped so results are attributable.
3. Measure: collect defined metrics against a baseline over an adequate window.
4. Promote to production: if the hypothesis holds and guardrails are respected, promote the change to the corresponding production configuration or workflow. Otherwise, retire the variant and record the finding.

Every experiment declares its hypothesis, metrics, and guardrails up front so outcomes are unambiguous and reproducible.

## Subfolders

| Subfolder | Purpose |
| --- | --- |
| `prompts/` | Prompt experiments. |
| `agents/` | Agent behavior experiments. |
| `workflows/` | Workflow and orchestration experiments. |
| `ab-tests/` | A/B tests on content and product, with metrics and guardrails. |
