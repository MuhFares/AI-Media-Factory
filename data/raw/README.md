# Data / Raw

Untouched source data exactly as ingested. This is the landing zone for inbound data before any cleaning or transformation. Content here is treated as immutable so processing can always be re-run from the original source.

## What belongs here

- Source data captured as received, with no modification.
- Ingestion metadata such as source, timestamp, and batch identifier.

## What does not belong here

- Cleaned or transformed data, which belongs in `processed/`.
- Curated datasets, which belong in `datasets/`.

## Large files are git-ignored

Raw data payloads are git-ignored placeholders. Actual raw data is stored in object storage and data stores, not in version control. This folder is anchored by its README.

## Naming conventions

- Organize by source and ingestion date.
- Preserve original formats; do not rename or reshape source records.
