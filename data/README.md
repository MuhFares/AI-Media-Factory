# Data

The data lifecycle for the AI Media Factory platform. This area holds data as it moves from ingestion through processing, curation, and outbound distribution. It is distinct from a `knowledge/` area: `knowledge/` holds curated, human-oriented reference material and institutional knowledge, whereas `data/` holds the operational data pipeline artifacts that flow through automated stages.

## Large files are git-ignored

Generated artifacts and large binary data files are git-ignored. The folders in this area are anchored by their README and may contain small placeholder files. Actual datasets, extracts, and raw payloads are not committed to version control; they are stored in the platform's data stores and object storage.

## Subfolders

| Subfolder | Purpose |
| --- | --- |
| `raw/` | Untouched source data exactly as ingested. |
| `processed/` | Cleaned and transformed data ready for use. |
| `datasets/` | Curated, versioned datasets for training and evaluation. |
| `exports/` | Outbound extracts and reports. |
| `analytics/` | Analytics event data and aggregates. |
