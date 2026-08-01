# Thumbnail Agent — Configuration

This folder holds the thumbnail agent's declarative configuration. It defines how the agent is instantiated and constrained at runtime, without embedding any of that behavior in code.

Configuration files here will be authored as YAML or JSON and are environment-overridable, so values can differ between local, staging, and production without changing the agent contract. Expected settings include:

- Model selection and provider for image generation and reasoning.
- Temperature and other sampling parameters.
- Tool allow-list defining which capabilities the agent may invoke, such as image generation and editing tools.
- Budget and rate limits governing cost and call frequency.
- Guardrails such as brand-safety filters and text-overlay length limits.

No configuration values are defined yet; this README anchors the folder and documents its intent.
