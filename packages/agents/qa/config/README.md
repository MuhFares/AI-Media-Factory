# QA Agent — Configuration

This folder holds the QA agent's declarative configuration. It defines how the agent is instantiated and constrained at runtime, without embedding any of that behavior in code.

Configuration files here will be authored as YAML or JSON and are environment-overridable, so values can differ between local, staging, and production without changing the agent contract. Expected settings include:

- Model selection and provider for the agent's inspection reasoning.
- Temperature and other sampling parameters.
- Tool allow-list defining which capabilities the agent may invoke.
- Budget and rate limits governing cost and call frequency.
- Guardrails such as the gate-only decision scope and the no-trade rule on quality failures.

No configuration values are defined yet beyond `config.yaml`; this README anchors the folder and documents its intent.
