# Data / Processed

Cleaned and transformed data ready for use. Content here is derived from `raw/` through repeatable processing steps: normalization, deduplication, validation, and enrichment.

## What belongs here

- Data that has passed cleaning and transformation.
- Intermediate outputs that downstream stages consume.

## What does not belong here

- Original source data, which belongs in `raw/`.
- Finalized curated datasets, which belong in `datasets/`.

## Large files are git-ignored

Processed data files are git-ignored placeholders. Actual processed data is stored in the platform's data stores and object storage, not in version control. This folder is anchored by its README.

## Naming conventions

- Organize by processing stage and source lineage.
- Record the transformation version so outputs can be traced to their inputs.
