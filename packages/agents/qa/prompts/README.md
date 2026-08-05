# QA Agent — Prompts

This folder holds the versioned system and user prompt templates that define the QA agent's inspection scope, verdict framing, and defect-reporting style. Templates are versioned so prompt changes can be reviewed, compared, and rolled back.

Prompts here integrate with `packages/prompts`, the shared prompt registry, which provides common building blocks, formatting conventions, and version tracking across all agents. The templates keep QA strictly within its objective gate — technical and schema conformance — and out of brand-voice judgment, which belongs to the Brand agent.
