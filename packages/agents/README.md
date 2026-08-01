# Agents

The `agents` package is the multi-agent "digital company" layer of the AI Media Factory. It models an autonomous media and content production business as a coordinated set of specialist agents, each responsible for a distinct function of the operation.

## The Digital Company Metaphor

The package is organized around an org-chart metaphor. A single CEO agent sits at the top and supervises a team of specialist agents, much like an executive coordinating department heads in a traditional media company. Each specialist owns a well-defined domain (research, writing, SEO, thumbnails, video, publishing, analytics, finance, and growth), while the orchestrator agent maps the org chart onto concrete runtime workflows.

This structure lets the system reason about responsibilities, hand-offs, and accountability in business terms rather than as an undifferentiated pool of prompts.

## Shared Agent Anatomy

Every agent folder follows the same shared anatomy so the codebase stays predictable and each agent can be understood, tested, and evolved in isolation:

- `README.md` — the agent contract: responsibilities, inputs, outputs, dependencies, KPIs, and roadmap.
- `config/` — declarative configuration such as model selection, temperature, tool allow-lists, and budget or rate limits.
- `memory/` — the agent's short-term, long-term, and episodic memory layers.
- `prompts/` — versioned system and user prompt templates.
- `tests/` — eval-style tests for prompt regression, schema validation, and behavioral checks.

## Implementation Status

No agent logic is implemented yet. This package currently defines contracts and documentation only. The READMEs describe the intended behavior, interfaces, and dependencies of each agent so that implementation can proceed against a clear, agreed specification. Application logic, APIs, and real agent code will be added later.

## Orchestration

Agents are not invoked directly. They are orchestrated by `apps/orchestrator`, which composes the agents into workflows and manages runtime execution. The orchestration layer is expected to build on established multi-agent frameworks such as LangGraph, CrewAI, and the Model Context Protocol (MCP) for tool access and inter-agent messaging. The `orchestrator` agent in this package describes the workflow-execution contract that `apps/orchestrator` implements at runtime.

## Agent Roster

| Agent | Responsibility |
| --- | --- |
| `ceo` | Sets strategy, prioritizes initiatives, and supervises all specialist agents. |
| `orchestrator` | Executes multi-agent workflows and manages runtime task routing and hand-offs. |
| `research` | Discovers topics, trends, and source material to feed the content pipeline. |
| `writer` | Produces scripts, captions, and long-form written content from research briefs. |
| `seo` | Optimizes titles, descriptions, tags, and metadata for search and discovery. |
| `thumbnail` | Designs and generates click-optimized thumbnail and cover imagery. |
| `video` | Assembles, edits, and renders finished video assets from scripts and media. |
| `publisher` | Schedules and distributes finished content across target platforms. |
| `analytics` | Measures content performance and reports actionable insights back to the company. |
| `finance` | Tracks budgets, costs, and unit economics across the production pipeline. |
| `growth` | Runs audience acquisition and retention experiments to scale reach. |
