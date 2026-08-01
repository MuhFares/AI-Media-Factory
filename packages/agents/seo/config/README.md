# SEO Agent — Configuration

This folder holds the SEO agent's declarative configuration. It defines how the agent is instantiated and constrained at runtime, without embedding any of that behavior in code.

Configuration files here will be authored as YAML or JSON and are environment-overridable, so values can differ between local, staging, and production without changing the agent contract. Expected settings include:

- Model selection and provider for the agent's reasoning.
- Temperature and other sampling parameters.
- Tool allow-list defining which capabilities the agent may invoke, such as keyword and SERP APIs.
- Budget and rate limits governing cost and call frequency.
- Guardrails such as keyword-stuffing limits and platform policy compliance.

No configuration values are defined yet; this README anchors the folder and documents its intent.
