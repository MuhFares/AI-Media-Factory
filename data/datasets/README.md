# Data / Datasets

Curated, versioned datasets for training and evaluation. These are deliberately assembled collections built from processed data and held to a defined schema and quality bar.

## What belongs here

- Curated dataset definitions and their version records.
- Train, validation, and evaluation splits.
- Dataset documentation: schema, provenance, and intended use.

## What does not belong here

- Raw or intermediate data, which belong in `raw/` and `processed/`.
- Outbound reports, which belong in `exports/`.

## Large files are git-ignored

Dataset contents are git-ignored placeholders. Actual dataset files are versioned in the platform's dataset store and object storage, not in version control. This folder is anchored by its README.

## Naming conventions

- Include an explicit version in each dataset identifier.
- Keep splits named consistently, for example `train`, `validation`, `eval`.
