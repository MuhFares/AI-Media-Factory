# Video Agent — Configuration

This folder holds the video agent's declarative configuration. It defines how the agent is instantiated and constrained at runtime, without embedding any of that behavior in code.

Configuration files here will be authored as YAML or JSON and are environment-overridable, so values can differ between local, staging, and production without changing the agent contract. Expected settings include:

- Model selection and provider for reasoning and media generation.
- Temperature and other sampling parameters.
- Tool allow-list defining which capabilities the agent may invoke, such as rendering and editing tools.
- Budget and rate limits governing compute cost and job frequency.
- Guardrails such as maximum render duration and output-format constraints.

No configuration values are defined yet; this README anchors the folder and documents its intent.
