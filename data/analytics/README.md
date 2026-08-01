# Data / Analytics

Analytics event data and aggregates. This folder holds the event streams and derived aggregates that measure platform and content performance.

## What belongs here

- Event data captured from the platform and published content.
- Aggregates and rollups derived from raw events.
- Definitions of the metrics and dimensions used in analysis.

## What does not belong here

- Operational pipeline data, which belongs in `raw/` or `processed/`.
- Delivered reports, which belong in `exports/`.

## Large files are git-ignored

Analytics data files are git-ignored placeholders. Actual event and aggregate data is stored in the platform's analytics store, not in version control. This folder is anchored by its README.

## Naming conventions

- Organize by event domain and time window.
- Keep metric and dimension names stable so aggregates remain comparable over time.
