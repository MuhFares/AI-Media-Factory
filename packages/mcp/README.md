# MCP

## Purpose

The mcp package provides Model Context Protocol servers and clients along with the tool definitions exposed to agents. It standardizes how agents discover and invoke tools and how external context is supplied to models across the AI Media Factory.

## Responsibilities

- Implement MCP servers that expose tools and context.
- Provide MCP clients used by agents and the orchestrator.
- Define and register tool schemas.
- Standardize context exchange between models and tools.
- Manage tool access boundaries.

## MCP Servers

- Servers that expose media capabilities backed by `packages/media`.
- Servers that expose data access backed by `packages/database`.
- Servers that expose external integrations and platform APIs.

## Tool Registry

A central registry of tool definitions describing each tool's name, inputs, outputs, and access scope. The registry is the source of truth for the tools available to agents.

## Consumers

- `apps/orchestrator` for tool access during workflow execution.
- `packages/agents` for capabilities available to agent definitions.

## Roadmap

- Dynamic tool discovery.
- Per agent tool scoping and permissions.
- Tool usage auditing.
- Remote MCP server federation.
