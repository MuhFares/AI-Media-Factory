# Packages

Shared libraries for the AI Media Factory. Packages hold reusable capabilities consumed by the runtime apps. The package layer is polyglot: some packages are TypeScript libraries and some are Python libraries, chosen to match the consumers and the domain of each package.

## Taxonomy

| Package   | Purpose                                                                                  | Primary Language |
|-----------|------------------------------------------------------------------------------------------|------------------|
| agents    | Agent definitions, roles, and capabilities loaded by the orchestrator.                   | Python           |
| analytics | Metrics, KPIs, event tracking, and the data layer behind dashboards and attribution.     | TypeScript       |
| database  | Data access layer, schema and migrations, ORM models, and vector store integration.      | TypeScript       |
| media     | Shared media primitives: FFmpeg wrappers, media types, codecs, and rendering utilities.  | Python           |
| mcp       | Model Context Protocol servers, clients, and tool definitions exposed to agents.         | Python           |
| prompts   | Centralized versioned prompt registry, templates, and evaluation harness references.     | TypeScript       |
| shared    | Cross cutting types, utilities, and configuration shared across TypeScript packages.     | TypeScript       |

## Workspace Registration

Only the TypeScript packages are registered as npm workspaces. The Python packages are managed by the Python toolchain and are not part of the npm workspace graph, even though they live alongside the TypeScript packages in this directory.
