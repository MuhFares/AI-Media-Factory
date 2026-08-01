# Data / Exports

Outbound extracts and reports. This folder holds data prepared for consumption outside the platform, such as scheduled extracts, delivered reports, and shared data snapshots.

## What belongs here

- Generated extracts destined for external systems or stakeholders.
- Reports produced for distribution.
- Export manifests describing contents and delivery targets.

## What does not belong here

- Internal pipeline data, which belongs in `raw/`, `processed/`, or `datasets/`.
- Analytics event data, which belongs in `analytics/`.

## Large files are git-ignored

Export artifacts are git-ignored placeholders. Actual export files are written to object storage or delivered to their destinations, not committed to version control. This folder is anchored by its README.

## Naming conventions

- Name exports by target and generation date.
- Include format and version in the artifact name where relevant.
