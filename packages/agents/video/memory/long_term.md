# Video Agent — Long-Term Memory

Durable knowledge that persists across runs. Vector-backed; linked to [packages/database](../../database/README.md) and the [Company Brain](../../../memory/company/README.md).

## What is stored here

- **Render profiles.** Proven encoding presets by target (resolution, codec, bitrate) mapped to their typical cost and quality, so future renders start from a known-good, cost-efficient profile.
- **Per-brand edit conventions.** Pacing, transition style, caption styling, and format rules each brand has settled on, learned from QA outcomes.
- **Cost history.** Actual render cost per asset and per finished minute over time, used to estimate future jobs against the cost ceiling.
- **Failure patterns.** Recurring causes of fatal render errors and unusable source media, and the fixes that resolved them.

## How it is used

At the start of each render the Video agent loads the matching render profile and the brand's edit conventions so it does not re-plan from scratch, and checks cost history to estimate the job before dispatch. QA outcomes are written back so the profile that best passes the gate compounds over time — this is the Compounding Knowledge value in practice.

## Retention

Long-term memory is durable and versioned. Superseded render profiles are marked deprecated, not deleted, so past assets remain reproducible.
