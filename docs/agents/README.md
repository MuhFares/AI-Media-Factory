# Agents

This directory is the canonical documentation of the agent organization within the AI Media Factory. It describes how autonomous agents are structured, what contracts they expose, and how they coordinate.

## Scope

- The agent org-chart: roles, responsibilities, and reporting relationships.
- Agent contracts: inputs, outputs, capabilities, and guarantees.
- Interaction protocols: messaging, hand-offs, and orchestration patterns.

## Cross-Reference

The runtime implementation of these agents lives in `packages/agents`. This directory documents the design and contracts; `packages/agents` contains the executable code. Keep both in sync when contracts change.

## Planned Documents

| Document | Description |
| --- | --- |
| `org-chart.md` | The agent hierarchy and role definitions. |
| `agent-contracts.md` | Formal contract definitions for each agent. |
| `interaction-protocols.md` | Messaging, hand-off, and orchestration protocols. |
| `lifecycle.md` | Agent creation, execution, and termination lifecycle. |
