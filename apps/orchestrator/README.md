# Orchestrator

## Purpose

The orchestrator is the AI workflow brain of the AI Media Factory. It turns high level requests into executable AI workflows by loading agent definitions, composing them into graphs and crews, and driving them to completion. Heavy media processing is delegated to `apps/worker` so that reasoning and rendering stay cleanly separated.

## Responsibilities

- Load agent definitions from `packages/agents`.
- Compose agents into executable graphs and crews.
- Execute multi step AI workflows and manage their state transitions.
- Coordinate tool access through the Model Context Protocol.
- Delegate heavy media tasks to `apps/worker` via the shared queue.
- Persist workflow state and results through the shared datastores.

## Technology

- Python as the primary runtime.
- Access to relational, vector, and object datastores through `packages/database`.
- Prompt templates sourced from `packages/prompts`.

## Frameworks

- LangGraph for graph based workflow composition.
- CrewAI for role based multi agent crews.
- AgentRouter for routing tasks to the appropriate agents and models.
- MCP (Model Context Protocol) for standardized tool and context access.

## Execution Model

The orchestrator receives workflow requests enqueued by `apps/api`. It loads the relevant agent definitions, composes them into a graph or crew, and executes the workflow step by step. When a step requires video rendering, image generation, or other heavy media work, the orchestrator enqueues a job for `apps/worker` and continues once results are available. Workflow state is checkpointed so that long running executions can resume.

## Interfaces

The orchestrator consumes workflow jobs enqueued by `apps/api` and delegates media jobs to `apps/worker` through the shared task queue. It reads agent definitions from `packages/agents`, prompts from `packages/prompts`, and tools from `packages/mcp`, and it reads and writes state through `packages/database`.
