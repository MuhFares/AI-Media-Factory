# Configs / MCP

Model Context Protocol (MCP) server and client configuration. This folder defines how the platform connects to MCP servers and which tools those servers expose to agents.

## What belongs here

- Server definitions: connection details, transport, and lifecycle settings for each MCP server.
- Client configuration: how platform components discover and attach to MCP servers.
- Tool registries: the catalog of tools each server provides, along with access scoping.

## What does not belong here

- Tool implementation code.
- Agent-to-tool grant policies, which are declared in `configs/agents`.
- Secrets. Server credentials are referenced by name and sourced from the `environments` profiles.

## Naming conventions

- Name server configuration files after the server, in kebab-case, for example `filesystem-server`, `search-server`.
- Group tool registry entries under the owning server to keep discovery predictable.
