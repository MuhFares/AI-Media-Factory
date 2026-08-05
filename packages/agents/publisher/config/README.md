# Publisher Agent — Configuration

This folder holds the publisher agent's declarative configuration. It defines how the agent is instantiated and constrained at runtime, without embedding any of that behavior in code.

Configuration files here will be authored as YAML or JSON and are environment-overridable, so values can differ between local, staging, and production without changing the agent contract. Expected settings include:

- Model selection and provider for the agent's reasoning.
- Temperature and other sampling parameters.
- Tool allow-list defining which capabilities the agent may invoke, such as platform publishing APIs.
- Budget and rate limits governing cost, call frequency, and platform quotas.
- Guardrails such as platform policy compliance and publish-window constraints.

No configuration values are defined yet; this README anchors the folder and documents its intent.
