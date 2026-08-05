# Analytics Agent — Configuration

This folder holds the analytics agent's declarative configuration. It defines how the agent is instantiated and constrained at runtime, without embedding any of that behavior in code.

Configuration files here will be authored as YAML or JSON and are environment-overridable, so values can differ between local, staging, and production without changing the agent contract. Expected settings include:

- Model selection and provider for the agent's reasoning.
- Temperature and other sampling parameters.
- Tool allow-list defining which capabilities the agent may invoke, such as platform metrics and data warehouse queries.
- Budget and rate limits governing cost, call frequency, and ingestion volume.
- Guardrails such as data source allow-lists and attribution consistency checks.

No configuration values are defined yet; this README anchors the folder and documents its intent.
