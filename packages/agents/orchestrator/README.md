# Orchestrator Agent

The orchestrator agent maps the org chart onto concrete runtime workflow execution. It takes the CEO's directives and turns them into ordered, coordinated work across the specialist agents, managing task routing, hand-offs, retries, and completion. It is the runtime counterpart to `apps/orchestrator`.

## Responsibilities

- Compose specialist agents into end-to-end content production workflows.
- Route tasks to the correct agent and manage hand-offs between pipeline stages.
- Track workflow state, handle retries, timeouts, and failure recovery.
- Enforce ordering and dependencies between steps such as research before writing, writing before video.
- Emit execution telemetry for observability and downstream analysis.

## Inputs

- Prioritized initiatives and strategic directives from the `ceo` agent.
- Agent contracts and capability declarations from each specialist agent's `config/`.
- Runtime signals such as task completion, errors, and resource availability.

## Outputs

- Executable workflow runs with per-step task assignments.
- Completed pipeline artifacts routed to the `publisher` agent.
- Execution logs and status events consumed by the `analytics` agent.
- Failure and escalation notices routed back to the `ceo` agent.

## Dependencies

- `ceo` — source of directives to execute.
- All specialist agents — the workers the orchestrator coordinates.
- `apps/orchestrator` — the application that implements this contract at runtime using LangGraph, CrewAI, and MCP.
- `packages/database` — persistence for workflow state.

## KPIs

- Workflow completion rate and end-to-end latency.
- Task routing accuracy and hand-off success rate.
- Recovery rate from transient failures without human intervention.
- Resource efficiency per completed content unit.

## Future Roadmap

- Add dynamic workflow graphs that adapt based on intermediate results.
- Support parallel and speculative execution of independent branches.
- Introduce cost-aware scheduling in coordination with the `finance` agent.
- Provide replay and debugging of past workflow runs.
